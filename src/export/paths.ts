import { promises as fs } from "node:fs"
import path from "node:path"
import { exportError, exists, invalidPath, writeFailed } from "./errors.js"

const MARKDOWN = /\.(?:md|markdown)$/i

/** The Node error code, such as ENOENT, if the error has one. */
export function errorCode(error: unknown): string | undefined {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : undefined
}

/** A new file name for each export, such as granola-notes-20261030-140509Z.md. */
export function defaultName(content: string, now: Date): string {
  const stamp = now.toISOString().replace(/\.\d+Z$/, "Z").replace(/[-:]/g, "").replace("T", "-")
  return `granola-${content}-${stamp}.md`
}

/**
 * The folders and file name of a path relative to the export folder, with `.md` added when missing. Absolute
 * paths, `..`, hidden names, backslashes and control characters are refused before anything is read or asked.
 */
export function exportPath(raw: string): string[] {
  const refuse = (problem: string) => exportError(invalidPath(raw, problem))
  if (/[\u0000-\u001f\u007f]/.test(raw)) throw refuse("contains control characters")
  if (raw.includes("\\")) throw refuse("uses `\\`; separate folders with `/`")
  if (raw.startsWith("/") || raw.startsWith("~") || /^[A-Za-z]:/.test(raw)) throw refuse("is absolute; give a path relative to the export folder")
  const parts = raw.split("/")
  if (parts.includes("..")) throw refuse("leaves the export folder")
  if (parts.includes("")) throw refuse("has an empty folder or file name")
  if (parts.some((part) => part.startsWith("."))) throw refuse("names a hidden file or folder")
  const last = parts.length - 1
  if (!MARKDOWN.test(parts[last]!)) parts[last] += ".md"
  if (parts.some((part) => Buffer.byteLength(part) > 255)) throw refuse("has a name longer than 255 bytes")
  return parts
}

/** The configured export folder, after following a link, must be a folder. */
async function folder(root: string, relative: string): Promise<void> {
  if (!(await fs.stat(root)).isDirectory()) throw exportError(writeFailed(relative, "the export folder is a file, not a folder"))
}

async function lstat(file: string) {
  try {
    return await fs.lstat(file)
  } catch (error) {
    if (errorCode(error) === "ENOENT") return undefined
    throw error
  }
}

/**
 * Read-only check before the user is asked: a link or file in the way, or an existing target without
 * overwrite, fails now instead of after the meetings are fetched. Missing folders are fine.
 */
export async function preflight(root: string, parts: readonly string[], overwrite: boolean): Promise<void> {
  const relative = parts.join("/")
  if (!(await lstat(root))) return
  await folder(root, relative)
  let current = await fs.realpath(root)
  for (const [index, part] of parts.entries()) {
    current = path.join(current, part)
    const stat = await lstat(current)
    if (!stat) return
    if (stat.isSymbolicLink()) throw exportError(invalidPath(relative, `goes through the link \`${part}\``))
    if (index < parts.length - 1) {
      if (!stat.isDirectory()) throw exportError(invalidPath(relative, `goes through \`${part}\`, which is a file`))
    } else if (!stat.isFile()) {
      throw exportError(invalidPath(relative, "names a folder"))
    } else if (!overwrite) {
      throw exportError(exists(relative))
    }
  }
}

/**
 * Creates the export folder on the first approved export, then each missing folder of the path inside it,
 * checking that none is a link. The configured folder itself is trusted and may be a link.
 */
export async function prepare(root: string, parts: readonly string[]): Promise<{ root: string; destination: string }> {
  if (await lstat(root)) await folder(root, parts.join("/"))
  else await fs.mkdir(root, { recursive: true, mode: 0o700 })
  const canonical = await fs.realpath(root)
  let parent = canonical
  for (const part of parts.slice(0, -1)) {
    parent = path.join(parent, part)
    try {
      await fs.mkdir(parent, { mode: 0o700 })
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error
    }
    const stat = await fs.lstat(parent)
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw exportError(invalidPath(parts.join("/"), `goes through \`${part}\`, which is not a folder`))
    }
  }
  return { root: canonical, destination: path.join(parent, parts.at(-1)!) }
}
