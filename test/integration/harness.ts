// Starts OpenCode hosts for the host test: the public `@opencode/sdk` embedded in this process, or a stock
// `opencode serve` binary. Each host gets its own temp root holding OpenCode's home, the XDG directories, TMPDIR,
// its state, the export folders and one project directory per case, and refuses to run if OpenCode resolves its
// global paths anywhere else. The root sits under the system's /tmp, never under TMPDIR or HOME, where OpenCode's
// upward search would find the `.opencode` agents and skills of the person running the tests, and it is a git
// repository, which ends that search. Each stock host listens on its own free port. The probe plugin routes Granola's official URL to the
// synthetic server on 127.0.0.1; any other outbound HTTP goes to a dead proxy.
import { spawn, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { arch, platform } from "node:os"
import { join, sep } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import { OpenCode as Remote, type OpenCodeClient } from "@opencode/client"
import { TESTED_HOSTS } from "../../src/hosts.js"
import { defaultRules, type Rule } from "../../src/permissions.js"
import type { SyntheticGranola } from "../synthetic-granola/server.js"

export const REPO = realpathSync(fileURLToPath(new URL("../..", import.meta.url)))
const PROBE = join(REPO, "test", "integration", "probe")
export const OFFICIAL_URL = "https://mcp.granola.ai/mcp"

/** The stock OpenCode releases the plugin is tested on: the one list in src/hosts.ts. */
export const HOST_VERSIONS: readonly string[] = TESTED_HOSTS

/** The system temp directory, resolved (/private/tmp on macOS). Not TMPDIR, which may sit under HOME. */
const TEMP = realpathSync("/tmp")

/** A new directory under TEMP; with `repository`, also a git repository, so OpenCode's upward search stops there. */
function tempDirectory(prefix: string, repository = false): string {
  const path = realpathSync(mkdtempSync(join(TEMP, prefix)))
  if (repository) {
    const result = spawnSync("git", ["init", "--quiet", path], { encoding: "utf8" })
    if (result.status !== 0) throw new Error(`git init ${path} failed: ${result.stderr}`)
  }
  return path
}

export type Client = Pick<OpenCodeClient, "agent" | "command" | "experimental" | "integration" | "location" | "mcp" | "permission" | "plugin" | "rpc" | "server" | "session" | "skill">

/**
 * - main: connected, with the user's own rules and agents, including two for scripts;
 * - needs-auth and pending: the two connection states before Granola's tools are available;
 * - adopted: the user's own `granola` entry for the official URL, and a project skill with the id `granola`;
 * - conflict: the user's own `granola` entry for another server;
 * - invalid: a plugin option the plugin does not support;
 * - untested: connected, with allowUntestedHost;
 * - automation: connected, with exports allowed for runs where nobody is present;
 * - ask-changes and read-only: connected, with the plugin option that restricts the default rules;
 * - unload: connected, then the plugin is removed from the config.
 * - sign-in: needs a sign-in, then signs in through the fake's own flow, so `/connect`'s mark can be checked.
 */
const PROJECTS = ["main", "needs-auth", "pending", "adopted", "conflict", "invalid", "untested", "automation", "ask-changes", "read-only", "unload", "sign-in"] as const
export type Project = (typeof PROJECTS)[number]

export interface Host {
  readonly version: string
  readonly client: Client
  /** The temp root every host file must stay inside. */
  readonly root: string
  /** Where this host keeps its state, relative to the root; the test checks it was written. */
  readonly state: string
  /** OpenCode's global config folder, relative to the root. */
  readonly config: string
  location(project: Project): { readonly directory: string }
  /** The export folder the plugin is configured with in a project. */
  exports(project: Project): string
  /** Replaces a project's config with one that no longer loads the Granola plugin. */
  removePlugin(project: Project): void
  close(): Promise<void>
}

const rule = (effect: Rule["effect"]) => (action: string, resource = "*"): Rule => ({ action, resource, effect })
const allow = rule("allow")
const deny = rule("deny")
const ask = rule("ask")

/** The user's own top-level rules for Granola tools in the main project. */
const USER_RULES: readonly Rule[] = [
  allow("granola_create_folder"),
  deny("granola_remove_note_from_folder"),
  // Exports into one folder run without asking.
  allow("granola_export_markdown", "scheduled/*"),
]

/** In the adopted project, relative to it: a skill of the user's with the id of the plugin's `granola` skill. */
export const SHADOWING_SKILL = join(".opencode", "skills", "granola", "SKILL.md")

/** The user's own server entry for the official URL, which the plugin adopts as it is. */
export const ADOPTED_SERVER = { type: "remote", url: OFFICIAL_URL, timeout: { execution: 120_000 } } as const
/** The user's own server entry under the plugin's server name, for a different server. */
export const OTHER_SERVER = { type: "remote", url: "https://mcp.example.invalid/mcp", disabled: true } as const

const configOnly = (description: string, permissions?: readonly Rule[]) => ({ description, mode: "primary", ...(permissions ? { permissions } : {}) })

/** Each project's opencode.jsonc. The probe comes after granola.meetings, because transforms run in config order. */
function projectConfig(project: Project, plugin: string, fake: SyntheticGranola, exports: string): object {
  const granola = (options: object = { exportDirectory: exports }) => ({ package: plugin, options })
  const probe = (route: Parameters<SyntheticGranola["url"]>[0] = "connected") => ({ package: PROBE, options: { route: fake.url(route) } })
  switch (project) {
    case "main":
      return {
        plugins: [granola(), probe()],
        permissions: USER_RULES,
        agents: {
          general: { permissions: [deny("granola_*")] },
          reviewer: configOnly("Defined only in user config"),
          // The fix status gives for an agent defined only in user config: the block, then the user's own rules.
          fixed: configOnly("Has the Granola permission block", [...defaultRules(), ...USER_RULES]),
          // For scripts: one denies every Granola tool, the other asks before one read.
          locked: configOnly("Denies Granola", [...defaultRules(), ...USER_RULES, deny("granola_*")]),
          careful: configOnly("Asks before get_meetings", [...defaultRules(), ...USER_RULES, ask("granola_get_meetings")]),
        },
        experimental: { schedules: true },
      }
    case "needs-auth":
      return { plugins: [granola(), probe("needs-auth")] }
    case "pending":
      return { plugins: [granola(), probe("pending")] }
    case "adopted":
      return { plugins: [granola(), probe()], mcp: { servers: { granola: ADOPTED_SERVER } } }
    case "conflict":
      return { plugins: [granola(), probe()], mcp: { servers: { granola: OTHER_SERVER } } }
    case "invalid":
      return { plugins: [granola({ exportDir: exports }), probe()] }
    case "untested":
      return { plugins: [granola({ exportDirectory: exports, allowUntestedHost: true }), probe()] }
    case "automation":
      // A schedule's check program is authorized per tool for every resource, so a narrower export rule does not cover it.
      return { plugins: [granola(), probe()], permissions: [allow("granola_export_markdown")], experimental: { schedules: true } }
    case "ask-changes":
      return { plugins: [granola({ exportDirectory: exports, access: "ask-changes" }), probe()], experimental: { schedules: true } }
    case "read-only":
      return { plugins: [granola({ exportDirectory: exports, access: "read-only" }), probe()], experimental: { schedules: true } }
    case "unload":
      return { plugins: [granola(), probe()], experimental: { schedules: true } }
    case "sign-in":
      return { plugins: [granola(), probe("sign-in")] }
  }
}

interface Root {
  readonly path: string
  readonly env: Readonly<Record<string, string>>
  directory(project: Project): string
  exports(project: Project): string
  removePlugin(project: Project): void
  remove(): void
}

function makeRoot(label: string, plugin: string, fake: SyntheticGranola): Root {
  const path = tempDirectory(`granola-host-${label}-`, true)
  const home = join(path, "home")
  const env = {
    HOME: home,
    // Bun reads the home directory once at startup and ignores a later HOME, so OpenCode's own variable sets it too.
    OPENCODE_TEST_HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    XDG_CACHE_HOME: join(home, ".cache"),
    TMPDIR: join(path, "tmp"),
  }
  for (const dir of Object.values(env)) mkdirSync(dir, { recursive: true })
  const directory = (project: Project) => join(path, "projects", project)
  const exports = (project: Project) => join(path, "exports", project)
  const write = (project: Project, config: object) => writeFileSync(join(directory(project), "opencode.jsonc"), JSON.stringify(config, null, 2))
  for (const project of PROJECTS) {
    mkdirSync(directory(project), { recursive: true })
    write(project, projectConfig(project, plugin, fake, exports(project)))
  }
  mkdirSync(join(directory("adopted"), SHADOWING_SKILL, ".."), { recursive: true })
  writeFileSync(join(directory("adopted"), SHADOWING_SKILL), "---\nname: granola\ndescription: The user's own Granola notes skill, for the host test.\n---\n\nUse the user's own steps.\n")
  const removePlugin = (project: Project) => {
    const config = projectConfig(project, plugin, fake, exports(project)) as { plugins: { package: string }[] }
    write(project, { ...config, plugins: config.plugins.filter((entry) => entry.package !== plugin) })
  }
  return { path, env, directory, exports, removePlugin, remove: () => rmSync(path, { recursive: true, force: true }) }
}

// Anything that tries the network fails fast instead of reaching Granola or another service.
const OFFLINE = {
  HTTP_PROXY: "http://127.0.0.1:9",
  HTTPS_PROXY: "http://127.0.0.1:9",
  http_proxy: "http://127.0.0.1:9",
  https_proxy: "http://127.0.0.1:9",
  NO_PROXY: "127.0.0.1,localhost",
  no_proxy: "127.0.0.1,localhost",
}

/** Stock binaries honour these. Without them a process still probes model hosts and the update service. */
const QUIET = {
  OPENCODE_DISABLE_MODELS_FETCH: "1",
  OPENCODE_DISABLE_AUTOUPDATE: "1",
  OPENCODE_DISABLE_FREE_MODELS: "1",
}

/** OpenCode's home and tmp folders as the host resolved them, read through the public API. */
export async function globalPaths(client: Pick<Client, "agent" | "server">, location: { readonly directory: string }): Promise<{ home?: string; tmp: string }> {
  const { paths } = await client.server.info()
  // Plan's built-in rule allows edits in <home>/.opencode/plan, so it shows the home OpenCode uses.
  const plan = (await client.agent.list({ location })).data.find((agent) => agent.id === "plan")
  const rule = plan?.permissions.find((entry) => entry.action === "edit" && entry.effect === "allow" && entry.resource.endsWith(`${sep}.opencode${sep}plan${sep}*`))
  return { ...(rule ? { home: rule.resource.slice(0, -`${sep}.opencode${sep}plan${sep}*`.length) } : {}), tmp: paths.tmp }
}

/** Fails before any case runs if OpenCode resolved its home or tmp folder outside the temp root. */
async function isolated(client: Pick<Client, "agent" | "server">, root: Root): Promise<void> {
  let paths: Awaited<ReturnType<typeof globalPaths>>
  // The first request for a location waits for its plugins, which can time out while the machine is busy.
  for (const deadline = Date.now() + 120_000; ;) {
    try {
      paths = await globalPaths(client, { directory: root.directory("main") })
      break
    } catch (error) {
      if (Date.now() > deadline) throw error
      await sleep(500)
    }
  }
  const inside = (path: string | undefined) => path !== undefined && path.startsWith(root.path + sep)
  if (!inside(paths.home) || !inside(paths.tmp)) throw new Error(`OpenCode resolved its paths outside ${root.path}: ${JSON.stringify(paths)}`)
}

const hostFields = (root: Root) => ({
  root: root.path,
  location: (project: Project) => ({ directory: root.directory(project) }),
  exports: root.exports,
  removePlugin: root.removePlugin,
})

/** The installed `@opencode/sdk` version, which the embedded host reports by default. */
const SDK_VERSION = (JSON.parse(readFileSync(join(REPO, "node_modules", "@opencode", "sdk", "package.json"), "utf8")) as { version: string }).version

/**
 * The public `@opencode/sdk` host in this process, at the version installed as a devDependency. `version` is the
 * OpenCode version it reports to plugins.
 */
export async function startEmbedded(fake: SyntheticGranola, version: string = SDK_VERSION): Promise<Host> {
  const root = makeRoot("sdk", REPO, fake)
  const saved = { ...process.env }
  const cwd = process.cwd()
  // A parent OpenCode session (an agent running this suite) must not leak in, and the environment must move before
  // the SDK is imported, because OpenCode reads its XDG directories at import.
  for (const key of Object.keys(process.env)) if (key.startsWith("OPENCODE")) delete process.env[key]
  Object.assign(process.env, root.env, OFFLINE, QUIET)
  const restore = () => {
    process.chdir(cwd)
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key]
    Object.assign(process.env, saved)
  }
  try {
    // The embedded SDK opens a location at the process working directory. Stay inside the temp root so that
    // location is not this repository.
    process.chdir(root.path)
    const { OpenCode } = await import("@opencode/sdk")
    const opencode = await OpenCode.create({
      // An embedded host reports "unknown" unless told, which the plugin's host check refuses.
      app: { version },
      config: { directory: join(root.path, "config"), project: true, claude: false },
      database: { path: join(root.path, "opencode.db") },
      models: { fetch: false },
      fs: { filewatcher: false },
      log: { level: "error", emit: () => {} },
    })
    try {
      await isolated(opencode, root)
    } catch (error) {
      await opencode.close()
      throw error
    }
    return {
      version,
      client: opencode,
      state: "opencode.db",
      config: "config",
      ...hostFields(root),
      close: async () => {
        await opencode.close()
        restore()
        root.remove()
      },
    }
  } catch (error) {
    restore()
    root.remove()
    throw error
  }
}

const binaries = new Map<string, string>()
const installs: string[] = []

/** Removes the stock releases stockBinary installed. Bun's test runner does not emit `exit`, so suites call this. */
export function removeInstalls(): void {
  for (const dir of installs.splice(0)) rmSync(dir, { recursive: true, force: true })
  binaries.clear()
}

/**
 * The stock CLI for `version`. Set OPENCODE_BIN_2_2_3 (and so on) to a binary you already have; otherwise the
 * unmodified npm release is installed into a temp directory with scripts disabled, once per version and run, and
 * removed by removeInstalls().
 */
function stockBinary(version: string): string {
  const given = process.env[`OPENCODE_BIN_${version.replaceAll(".", "_")}`]
  if (given !== undefined && given !== "") return given
  const known = binaries.get(version)
  if (known !== undefined) return known
  const dir = tempDirectory(`granola-host-opencode-${version}-`)
  installs.push(dir)
  // Its own package.json, and npm's cwd set to it: npm walks up from a folder that has none.
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "granola-host-opencode", private: true }))
  const result = spawnSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", `@opencode/cli@${version}`], { cwd: dir, encoding: "utf8" })
  const path = join(dir, "node_modules", "@opencode", `cli-${platform()}-${arch()}`, "bin", "opencode")
  if (result.status !== 0 || !existsSync(path)) throw new Error(`Could not install @opencode/cli@${version} for ${platform()}-${arch()}:\n${result.stderr}`)
  binaries.set(version, path)
  return path
}

/** Every `opencode debug paths` entry must sit inside the temp root. The command is local; it does not use the server. */
function assertDebugPaths(binary: string, env: NodeJS.ProcessEnv, root: string): void {
  const result = spawnSync(binary, ["debug", "paths"], { cwd: root, env, encoding: "utf8" })
  if (result.status !== 0) throw new Error(`${binary} debug paths failed (${result.status}): ${result.stderr}`)
  const paths = result.stdout.split("\n").flatMap((line) => {
    const value = line.trim().split(/\s+/).slice(1).join(" ")
    return value ? [value] : []
  })
  if (paths.length < 8) throw new Error(`${binary} debug paths returned ${paths.length} entries:\n${result.stdout}`)
  const outside = paths.filter((path) => !path.startsWith(root + sep))
  if (outside.length) throw new Error(`${binary} resolved paths outside ${root}: ${outside.join(", ")}`)
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  if (address === null || typeof address === "string") throw new Error("no free port")
  return address.port
}

/**
 * A stock `opencode serve` on its own port, with its own password, in an environment that holds only the temp
 * root. It never talks to another OpenCode service.
 */
export async function startBinary(version: string, fake: SyntheticGranola): Promise<Host> {
  const binary = stockBinary(version)
  const root = makeRoot(`cli-${version}`, REPO, fake)
  const password = randomUUID()
  const port = await freePort()
  const env = { ...root.env, ...OFFLINE, ...QUIET, PATH: "/usr/bin:/bin", OPENCODE_PASSWORD: password }
  const stop = () => root.remove()

  // Prints "opencode v2.2.3".
  const reported = spawnSync(binary, ["--version"], { cwd: root.path, env, encoding: "utf8" })
  if (reported.stdout.trim() !== `opencode v${version}`) {
    stop()
    throw new Error(`${binary} reports ${JSON.stringify(reported.stdout.trim())}, expected ${version}`)
  }
  try {
    assertDebugPaths(binary, env, root.path)
  } catch (error) {
    stop()
    throw error
  }

  let output = ""
  const server = spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: root.path, env, stdio: ["ignore", "pipe", "pipe"] })
  server.stdout.on("data", (chunk: Buffer) => void (output += chunk.toString()))
  server.stderr.on("data", (chunk: Buffer) => void (output += chunk.toString()))
  const exited = new Promise<void>((resolve) => server.once("exit", () => resolve()))
  const close = async () => {
    if (server.exitCode === null && server.signalCode === null) {
      server.kill("SIGTERM")
      const timer = setTimeout(() => server.kill("SIGKILL"), 10_000)
      await exited
      clearTimeout(timer)
    }
    stop()
  }

  const client = Remote.make({ baseUrl: `http://127.0.0.1:${port}`, headers: { authorization: `Basic ${btoa(`opencode:${password}`)}` } })
  for (const deadline = Date.now() + 120_000; ;) {
    try {
      await client.agent.list({ location: { directory: root.directory("main") } })
      break
    } catch (error) {
      if (server.exitCode !== null || Date.now() > deadline) {
        await close()
        throw new Error(`opencode ${version} serve did not become ready: ${String(error)}\n${output.slice(-2000)}`)
      }
      await sleep(500)
    }
  }
  try {
    await isolated(client, root)
  } catch (error) {
    await close()
    throw error
  }
  return { version, client, state: join("home", ".local", "share", "opencode"), config: join("home", ".config", "opencode"), ...hostFields(root), close }
}

/** Tracked and untracked changes in the repository, to show a host run wrote nothing there. */
export function repositoryChanges(): string {
  const result = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: REPO, encoding: "utf8" })
  if (result.status !== 0) throw new Error(`git status failed: ${result.stderr}`)
  return result.stdout
}
