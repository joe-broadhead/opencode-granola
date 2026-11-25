/**
 * The real OpenCode 2.4.1 host, embedded through the public `@opencode/sdk`, for host tests.
 *
 * Each host gets its own root under the system's /tmp (never TMPDIR or HOME, where OpenCode's upward search would
 * find the person's own `.opencode` agents and skills), holding OpenCode's home, the XDG directories, TMPDIR, the
 * database, and one git project whose `opencode.jsonc` loads this repository's built bundle. The root is removed on
 * close, and the environment is restored.
 */
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { join, sep } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import type { OpenCodeClient } from "@opencode/client"

export const REPO = realpathSync(fileURLToPath(new URL("../..", import.meta.url)))

/** The parts of the embedded client this suite uses. The real interface satisfies it structurally. */
export interface HostClient {
  readonly plugin: Pick<OpenCodeClient["plugin"], "list">
  readonly skill: Pick<OpenCodeClient["skill"], "list">
  readonly agent: Pick<OpenCodeClient["agent"], "list">
  readonly mcp: Pick<OpenCodeClient["mcp"], "list">
  readonly server: Pick<OpenCodeClient["server"], "info">
  readonly rpc: Pick<OpenCodeClient["rpc"], "call">
  readonly sessions: Pick<OpenCodeClient["session"], "create">
  close(): Promise<void>
}

/** The `@opencode/sdk` release installed here, which is the OpenCode release the embedded host reports. */
export const SDK_VERSION = (JSON.parse(readFileSync(join(REPO, "node_modules", "@opencode", "sdk", "package.json"), "utf8")) as { version: string }).version

/** The system temp directory, resolved (/private/tmp on macOS). Not TMPDIR, which may sit under HOME. */
const TEMP = realpathSync("/tmp")

/** Anything that tries the network fails fast instead of reaching the vendor or another service. */
const OFFLINE = {
  HTTP_PROXY: "http://127.0.0.1:9",
  HTTPS_PROXY: "http://127.0.0.1:9",
  http_proxy: "http://127.0.0.1:9",
  https_proxy: "http://127.0.0.1:9",
  NO_PROXY: "127.0.0.1,localhost",
  no_proxy: "127.0.0.1,localhost",
}

/** Without these a process still probes model hosts and the update service. */
const QUIET = { OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_DISABLE_AUTOUPDATE: "1", OPENCODE_DISABLE_FREE_MODELS: "1" }

export interface Host {
  readonly client: HostClient
  /** The temp root every host file stays inside. */
  readonly root: string
  readonly location: { readonly directory: string }
  close(): Promise<void>
}

/**
 * Starts the embedded host on the installed `@opencode/sdk` release and waits, with a bound, until `plugin` is
 * active. `options` are the plugin's `opencode.jsonc` options.
 */
export async function startHost(plugin: string, options: Readonly<Record<string, unknown>> = {}): Promise<Host> {
  const root = realpathSync(mkdtempSync(join(TEMP, "granola-host-")))
  const start = spawnSync("git", ["init", "--quiet", root], { encoding: "utf8" })
  if (start.status !== 0) throw new Error(`git init ${root} failed: ${start.stderr}`)

  const home = join(root, "home")
  const env = {
    HOME: home,
    // Bun reads the home directory once at startup and ignores a later HOME, so OpenCode's own variable sets it too.
    OPENCODE_TEST_HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    XDG_CACHE_HOME: join(home, ".cache"),
    TMPDIR: join(root, "tmp"),
  }
  for (const dir of [...Object.values(env), join(root, "config")]) mkdirSync(dir, { recursive: true })

  const project = join(root, "project")
  mkdirSync(project)
  writeFileSync(join(project, "opencode.jsonc"), JSON.stringify({ plugins: [{ package: REPO, options }] }, null, 2))

  const saved = { ...process.env }
  const cwd = process.cwd()
  // A parent OpenCode session must not leak in, and the environment must move before the SDK is imported, because
  // OpenCode reads its XDG directories at import.
  for (const key of Object.keys(process.env)) if (key.startsWith("OPENCODE")) delete process.env[key]
  Object.assign(process.env, env, OFFLINE, QUIET)
  const restore = () => {
    process.chdir(cwd)
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
    Object.assign(process.env, saved)
  }
  const location = { directory: project }
  let client: HostClient | undefined
  try {
    // The embedded SDK opens a location at the process working directory. Stay inside the temp root so that
    // location is not this repository.
    process.chdir(root)
    const { OpenCode } = await import("@opencode/sdk")
    client = (await OpenCode.create({
      app: { version: SDK_VERSION },
      config: { directory: join(root, "config"), project: true, claude: false },
      database: { path: join(root, "opencode.db") },
      models: { fetch: false },
      fs: { filewatcher: false },
      log: { level: "error", emit: () => {} },
    })) as HostClient
    const paths = (await client.server.info()).paths
    if (!paths.tmp.startsWith(root + sep)) throw new Error(`OpenCode resolved its tmp folder outside ${root}: ${paths.tmp}`)
    for (const deadline = Date.now() + 120_000; ;) {
      const entry = (await client.plugin.list({ location }).catch(() => undefined))?.data.find((item) => item.id === plugin)
      if (entry?.state.status === "active") break
      if (entry?.state.status === "failed") throw new Error(`${plugin} failed to load: ${entry.state.error}`)
      if (Date.now() > deadline) throw new Error(`${plugin} did not become active within 120 s`)
      await sleep(250)
    }
  } catch (error) {
    await client?.close().catch(() => undefined)
    restore()
    rmSync(root, { recursive: true, force: true })
    throw error
  }

  let closed = false
  return {
    client,
    root,
    location,
    async close() {
      if (closed) return
      closed = true
      await client?.close().catch(() => undefined)
      restore()
      rmSync(root, { recursive: true, force: true })
    },
  }
}
