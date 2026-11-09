import { createHash } from "node:crypto"
import { constants, promises as fs } from "node:fs"
import path from "node:path"

export interface MarkdownExportOptions {
  readonly destination: string
  readonly markdown: string
  /** Existing absolute directories. Symlink roots and symlinks below them are rejected. */
  readonly allowedRoots: readonly string[]
  /** Maximum encoded UTF-8 bytes, including any caller-supplied BOM. */
  readonly maxBytes: number
  readonly overwrite?: boolean
  readonly signal?: AbortSignal
  /** Synchronous caller-authority check after filesystem awaits, immediately before publication.
   * Throw to refuse publication. Never called after link/rename starts. */
  readonly assertPublication?: () => void
}

interface MarkdownExportResult {
  /** Canonical absolute destination. */
  readonly path: string
  readonly bytes: number
  readonly sha256: string
  /** Publication succeeded, but private staging cleanup failed and may leave files behind. */
  readonly cleanupDegraded?: true
}

/** Why the writer refused. An existing target keeps the EEXIST code that a lost publication race also has. */
type RefusalReason = "outside" | "link" | "not-a-file" | "changed" | "too-large"

export class MarkdownExportRefusal extends Error {
  constructor(readonly reason: RefusalReason, message: string) {
    super(message)
    this.name = "MarkdownExportRefusal"
  }
}

interface DirectoryIdentity {
  path: string
  canonical: string
  dev: bigint
  ino: bigint
}

function absolutePath(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !path.isAbsolute(value) ||
    value.includes("\0") ||
    value.split(path.sep).includes("..")
  ) {
    throw new TypeError(`${label} must be absolute, without NUL or parent traversal`)
  }
  return path.resolve(value)
}

function contains(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === "" || (
    relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
  )
}

async function directoryIdentity(directory: string): Promise<DirectoryIdentity> {
  const stat = await fs.lstat(directory, { bigint: true })
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new MarkdownExportRefusal(
      stat.isSymbolicLink() ? "link" : "not-a-file",
      "Export root and parent components must be real directories, not symlinks",
    )
  }
  return {
    path: directory,
    canonical: await fs.realpath(directory),
    dev: stat.dev,
    ino: stat.ino,
  }
}

async function recheckDirectories(directories: readonly DirectoryIdentity[]): Promise<void> {
  for (const previous of directories) {
    const current = await directoryIdentity(previous.path)
    if (
      current.canonical !== previous.canonical ||
      current.dev !== previous.dev ||
      current.ino !== previous.ino
    ) {
      throw new MarkdownExportRefusal("changed", "Export directory changed during the write")
    }
  }
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code
}

async function checkTarget(destination: string, overwrite: boolean): Promise<void> {
  let stat
  try {
    stat = await fs.lstat(destination)
  } catch (error) {
    if (hasCode(error, "ENOENT")) return
    throw error
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new MarkdownExportRefusal(
      stat.isSymbolicLink() ? "link" : "not-a-file",
      "Export target must be a regular file, not a symlink or directory",
    )
  }
  if (!overwrite) {
    throw Object.assign(new Error("Export destination already exists"), { code: "EEXIST" })
  }
}

async function unlinkIfPresent(file: string): Promise<void> {
  try {
    await fs.unlink(file)
  } catch (error) {
    if (!hasCode(error, "ENOENT")) throw error
  }
}

/**
 * Write caller-rendered Markdown without transport, policy, or SDK dependencies.
 * Parents must already exist. No directories are created except private staging
 * inside the selected destination parent. Files are published with mode 0600.
 *
 * Default publication uses a hard link (atomic create-if-absent); explicit
 * overwrite uses rename (atomic replacement, never opening the old target).
 * Both stay on the destination filesystem and have no non-atomic fallback.
 * Cancellation is honored until publication starts. Successful publication wins
 * a concurrent abort: the caller receives the committed result, not an abort.
 * Cleanup failure after publication returns cleanupDegraded: true. On failure,
 * the original operation error is preserved; cleanup is best-effort, so rejection
 * does not guarantee that staging was removed.
 *
 * SECURITY LIMIT: Node lacks portable dirfd-relative openat/renameat APIs.
 * Identity and realpath rechecks detect observed changes, but cannot prevent an
 * external actor renaming/replacing directories between a check and a filesystem
 * operation (including cleanup). Roots and ancestors must not be concurrently
 * mutated by untrusted actors. This is not a hostile-filesystem sandbox.
 */
export async function writeMarkdownExport(options: MarkdownExportOptions): Promise<MarkdownExportResult> {
  const { markdown, maxBytes, signal } = options
  const overwrite = options.overwrite === undefined ? false : options.overwrite
  if (typeof markdown !== "string") throw new TypeError("markdown must be a string")
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new TypeError("maxBytes must be a nonnegative safe integer")
  }
  if (typeof overwrite !== "boolean") throw new TypeError("overwrite must be boolean")
  if (!Array.isArray(options.allowedRoots) || options.allowedRoots.length === 0) {
    throw new TypeError("At least one allowed root is required")
  }
  signal?.throwIfAborted()
  const bytes = Buffer.byteLength(markdown, "utf8")
  if (bytes > maxBytes) throw new MarkdownExportRefusal("too-large", "Markdown exceeds the UTF-8 byte cap")
  const destination = absolutePath(options.destination, "destination")
  const roots: DirectoryIdentity[] = []
  for (const root of options.allowedRoots) {
    roots.push(await directoryIdentity(absolutePath(root, "allowed root")))
  }
  // Require both lexical membership and canonical membership. A similarly named
  // sibling (e.g. root-other) is not inside root.
  const root = roots
    .filter((entry) => contains(entry.path, destination) && entry.path !== destination)
    .sort((a, b) => b.path.length - a.path.length)[0]
  if (!root) throw new MarkdownExportRefusal("outside", "Export destination is outside the allowed roots")

  const directories = [root]
  let parent = root
  const relativeParent = path.relative(root.path, path.dirname(destination))
  for (const component of relativeParent.split(path.sep).filter(Boolean)) {
    parent = await directoryIdentity(path.join(parent.path, component))
    if (!contains(root.canonical, parent.canonical)) {
      throw new MarkdownExportRefusal("outside", "Export parent escapes the canonical allowed root")
    }
    directories.push(parent)
  }
  const target = path.join(parent.canonical, path.basename(destination))
  if (!contains(root.canonical, target)) throw new MarkdownExportRefusal("outside", "Export target escapes the allowed root")
  await checkTarget(target, overwrite)
  await recheckDirectories(directories)
  signal?.throwIfAborted()

  const data = Buffer.from(markdown, "utf8")
  const result: MarkdownExportResult = {
    path: target,
    bytes,
    sha256: createHash("sha256").update(data).digest("hex"),
  }
  const staging = await fs.mkdtemp(path.join(parent.canonical, ".markdown-export-"))
  const stagedFile = path.join(staging, "content.md")
  let cleanupDegraded = false
  try {
    // mkdtemp creates mode 0700 (subject to umask); set it explicitly before use.
    await fs.chmod(staging, 0o700)
    signal?.throwIfAborted()
    const handle = await fs.open(
      stagedFile,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    )
    try {
      await handle.writeFile(data, { signal })
      signal?.throwIfAborted()
      await handle.sync()
    } finally {
      await handle.close()
    }
    await recheckDirectories(directories)
    await checkTarget(target, overwrite)
    signal?.throwIfAborted()
    options.assertPublication?.()
    if (overwrite) {
      await fs.rename(stagedFile, target)
    } else {
      await fs.link(stagedFile, target)
    }
  } finally {
    // Remove only our named file and empty directory, never recursive parents.
    // Attempt both operations, but never mask the publication outcome.
    try {
      await unlinkIfPresent(stagedFile)
    } catch {
      cleanupDegraded = true
    }
    try {
      await fs.rmdir(staging)
    } catch {
      cleanupDegraded = true
    }
  }
  return cleanupDegraded ? { ...result, cleanupDegraded: true } : result
}
