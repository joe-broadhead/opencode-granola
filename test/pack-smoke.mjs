#!/usr/bin/env node
// Pack, install and import the published shape. The tarball holds exactly the files whitelist and installs alone,
// with scripts off and no dependencies. Installed alone, it loads in each stock OpenCode release, which provides
// @opencode/plugin, OpenTUI and Solid itself. Next to those host packages, '.' and './tui' import under Bun, and './rpc' is not exported.
//
// Usage: node test/pack-smoke.mjs [--tarball <path>]. Without --tarball it builds and packs the repository; with it,
// it tests that exact tarball, as release.yml does before publishing it. Needs npm and Bun. Set OPENCODE_BIN_2_2_3,
// OPENCODE_BIN_2_2_4 and OPENCODE_BIN_2_2_5 to stock opencode binaries you already have; otherwise each @opencode/cli
// release is installed into a temp directory, once per run.
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { arch, platform } from "node:os"
import { join, relative, resolve, sep } from "node:path"
import { after, before, test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"
import { fileURLToPath } from "node:url"
import ts from "typescript"
// Node 24 strips the types of this one plain module, so the pack test shares the host test's list.
import { TESTED_HOSTS } from "../src/hosts.ts"

const REPO = realpathSync(fileURLToPath(new URL("..", import.meta.url)))
const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"))

/** The stock OpenCode releases the package is tested on: the one list in src/hosts.ts. */
const HOST_VERSIONS = TESTED_HOSTS
const SUPPORTED_RANGE = ">=2.2.3 <2.3.0"
const MAX_BYTES = 1024 * 1024
const OFFICIAL_URL = "https://mcp.granola.ai/mcp"
const SKILLS = ["granola", "granola-meeting-brief"]
// What OpenCode provides to plugins, installed at the versions pinned for development.
const HOST_PACKAGES = ["@opencode/plugin", "@opentui/core", "@opentui/solid", "solid-js"]
const SERVER_MODULES = [/^node:/, /^@opencode\/plugin(?:\/|$)/]
const TUI_MODULES = [...SERVER_MODULES, /^@opentui\/(?:core|solid)(?:\/|$)/, /^solid-js(?:\/|$)/]
const INSTALL_SCRIPTS = ["preinstall", "install", "postinstall", "prepare", "prepack", "postpack"]
const UNDECLARED = ["dependencies", "optionalDependencies", "bundleDependencies", "bundledDependencies", "peerDependencies", "peerDependenciesMeta"]
// Anything that tries the network fails fast instead of reaching Granola or another service.
const OFFLINE = {
  HTTP_PROXY: "http://127.0.0.1:9",
  HTTPS_PROXY: "http://127.0.0.1:9",
  http_proxy: "http://127.0.0.1:9",
  https_proxy: "http://127.0.0.1:9",
  NO_PROXY: "127.0.0.1,localhost",
  no_proxy: "127.0.0.1,localhost",
}
// Stock binaries honour these. Without them a serve still probes model hosts and the update service.
const QUIET = {
  OPENCODE_DISABLE_MODELS_FETCH: "1",
  OPENCODE_DISABLE_AUTOUPDATE: "1",
  OPENCODE_DISABLE_FREE_MODELS: "1",
}

// Outside the repository, so module resolution cannot fall back to the repository's own node_modules. Under the
// system's /tmp, never under TMPDIR or HOME, and a git repository, so OpenCode's upward search finds no `.opencode`
// folder of the person running the test.
const work = realpathSync(mkdtempSync(join(realpathSync("/tmp"), "granola-pack-")))
run("git", ["init", "--quiet", work], work)
after(() => rmSync(work, { recursive: true, force: true }))

const tarballFlag = process.argv.indexOf("--tarball")
const GIVEN = tarballFlag === -1 ? undefined : resolve(process.argv[tarballFlag + 1] ?? "")

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env: { ...env, npm_config_update_notifier: "false" } })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status}):\n${result.stderr}\n${result.stdout}`)
  return result.stdout
}

const tree = (dir) => readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter((item) => item.isFile() && item.name !== ".DS_Store")
  .map((item) => relative(REPO, join(item.parentPath, item.name)).split(sep).join("/"))

/** The two self-contained entry bundles: dist holds nothing else. */
const DIST = ["dist/index.js", "dist/tui.js"]

/** What each `files` entry should contribute. */
function expectedFiles() {
  return ["package.json", ...pkg.files.flatMap((entry) => {
    if (entry === "dist") return DIST
    assert.ok(existsSync(join(REPO, entry)), `${entry} from the files list exists`)
    return statSync(join(REPO, entry)).isDirectory() ? tree(join(REPO, entry)) : [entry]
  })].sort()
}

let packed
let tarball
let alone

/** A consumer project with the tarball installed, alone or next to `extra` packages. */
function consumer(name, extra = []) {
  const dir = join(work, name)
  mkdirSync(dir)
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `granola-pack-${name}`, private: true, type: "module" }))
  run("npm", ["install", tarball, ...extra, "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline"], dir)
  return { dir, installed: join(dir, "node_modules", ...pkg.name.split("/")) }
}

before(() => {
  if (GIVEN) {
    assert.ok(existsSync(GIVEN), `--tarball ${GIVEN} exists`)
    // npm reads the tarball's own metadata; the folder has a package.json, so npm never walks up to another project.
    const inspect = join(work, "inspect")
    mkdirSync(inspect)
    writeFileSync(join(inspect, "package.json"), JSON.stringify({ name: "granola-pack-inspect", private: true }))
    packed = JSON.parse(run("npm", ["pack", GIVEN, "--dry-run", "--json", "--ignore-scripts"], inspect))[0]
    tarball = GIVEN
  } else {
    // Build explicitly: the package has no prepare script, and npm would run one even with --ignore-scripts.
    run("npm", ["run", "build"], REPO)
    packed = JSON.parse(run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", work], REPO))[0]
    tarball = join(work, packed.filename)
  }
  alone = consumer("alone")
})

/**
 * Every module `file` imports, statically, with import() or with require(), that `allowed` does not cover. A relative
 * specifier is never allowed: each entry is self-contained.
 */
function foreignImports(file, allowed) {
  const text = readFileSync(file, "utf8")
  const foreign = ts.preProcessFile(text, true, true).importedFiles
    .map(({ fileName }) => fileName)
    .filter((name) => !allowed.some((pattern) => pattern.test(name)))
  // ESM bundles never need require(), and a computed import() names no module preProcessFile can see, so both are refused.
  if (/\bimport\s*\(\s*[^'"`\s]|\brequire\s*\(/.test(text)) foreign.push("a require() or a computed import()")
  return [...new Set(foreign)].sort()
}

test("the tarball holds exactly the files whitelist, with no source or JSX, under 1 MB", () => {
  const paths = packed.files.map((file) => file.path).sort()
  assert.deepEqual(paths, expectedFiles())
  assert.deepEqual(paths.filter((path) => /\.(?:tsx?|jsx|map)$|(?:^|\/)node_modules\//.test(path)), [])
  for (const target of Object.values(pkg.exports)) {
    assert.ok(paths.includes(target.replace(/^\.\//, "")), `export target ${target} is in the tarball`)
  }
  assert.ok(packed.size < MAX_BYTES, `tarball ${packed.size} bytes`)
  assert.ok(packed.unpackedSize < MAX_BYTES, `unpacked ${packed.unpackedSize} bytes`)
  console.log(`# ${packed.filename}: ${packed.entryCount} files, ${packed.size} bytes packed, ${packed.unpackedSize} unpacked`)
})

// The private flag is not checked here: release.yml checks it itself.
test("its package.json states the tested OpenCode line, and has no dependencies, peers or install scripts", () => {
  const manifest = JSON.parse(readFileSync(join(alone.installed, "package.json"), "utf8"))
  assert.deepEqual(manifest.opencode, { host: SUPPORTED_RANGE })
  for (const field of UNDECLARED) assert.equal(manifest[field], undefined, field)
  assert.deepEqual(Object.keys(manifest.scripts ?? {}).filter((name) => INSTALL_SCRIPTS.includes(name)), [])
})

test("it installs alone: no TypeScript, Babel, zod, effect, OpenTUI or Solid comes with it", () => {
  const modules = join(alone.dir, "node_modules")
  const names = readdirSync(modules, { withFileTypes: true })
    .filter((item) => item.isDirectory() && !item.name.startsWith("."))
    .flatMap((item) => (item.name.startsWith("@") ? readdirSync(join(modules, item.name)).map((name) => `${item.name}/${name}`) : [item.name]))
  assert.deepEqual(names, [pkg.name])
})

// OpenCode reloads a plugin in place and can keep an older copy of an unchanged sibling module, which a new entry
// would then import. Two self-contained entries, and no other JavaScript, leave nothing stale to import.
test("dist holds exactly two self-contained entries, which import only modules OpenCode provides", () => {
  const dist = join(alone.installed, "dist")
  const js = readdirSync(dist, { recursive: true }).filter((name) => /\.[cm]?js$/.test(name)).map((name) => `dist/${name.split(sep).join("/")}`).sort()
  assert.deepEqual(js, DIST)
  assert.deepEqual(foreignImports(join(dist, "index.js"), SERVER_MODULES), [])
  assert.deepEqual(foreignImports(join(dist, "tui.js"), TUI_MODULES), [])
  // The check itself refuses relative, dynamic and computed loads.
  const probe = join(work, "probe.js")
  writeFileSync(probe, 'import { a } from "./status.js"\nawait import("./chunk.js")\nrequire("./old.js")\n')
  assert.deepEqual(foreignImports(probe, TUI_MODULES), ["./chunk.js", "./old.js", "./status.js", "a require() or a computed import()"])
})

const binaries = new Map()

/**
 * The stock CLI for `version`: OPENCODE_BIN_2_2_3 (and so on) if set, otherwise the unmodified npm release,
 * installed into the temp directory with scripts off, once per version.
 */
function stockBinary(version) {
  const given = process.env[`OPENCODE_BIN_${version.replaceAll(".", "_")}`]
  if (given) return given
  if (binaries.has(version)) return binaries.get(version)
  const dir = join(work, `opencode-${version}`)
  mkdirSync(dir)
  // Its own package.json, so npm installs here and never walks up to another project.
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "granola-pack-opencode", private: true }))
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", `@opencode/cli@${version}`], dir)
  const path = join(dir, "node_modules", "@opencode", `cli-${platform()}-${arch()}`, "bin", "opencode")
  assert.ok(existsSync(path), `@opencode/cli@${version} has no binary for ${platform()}-${arch()}`)
  binaries.set(version, path)
  return path
}

async function freePort() {
  const server = createServer()
  await new Promise((done) => server.listen(0, "127.0.0.1", done))
  const { port } = server.address()
  await new Promise((done) => server.close(done))
  return port
}

/**
 * OpenCode's home and tmp folders as a stock server resolved them, read with the host test's globalPaths() through
 * @opencode/client. Bun runs it, as it runs the host test.
 */
function globalPaths(port, authorization, directory) {
  const script = [
    `import { OpenCode } from "@opencode/client"`,
    `import { globalPaths } from ${JSON.stringify(join(REPO, "test", "integration", "harness.ts"))}`,
    `const client = OpenCode.make({ baseUrl: ${JSON.stringify(`http://127.0.0.1:${port}`)}, headers: { authorization: ${JSON.stringify(authorization)} } })`,
    `console.log(JSON.stringify(await globalPaths(client, { directory: ${JSON.stringify(directory)} })))`,
  ].join("\n")
  return JSON.parse(run("bun", ["-e", script], REPO, { ...process.env, ...OFFLINE }).trim().split("\n").at(-1))
}

/**
 * A stock `opencode serve` on its own port, in an environment that holds only its temp root, with a project that
 * loads the installed package. The project keeps the official granola server disabled, so nothing reaches Granola.
 */
async function serve(version) {
  const binary = stockBinary(version)
  const root = join(work, `host-${version}`)
  const home = join(root, "home")
  const project = join(root, "project")
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
  for (const dir of [...Object.values(env), project]) mkdirSync(dir, { recursive: true })
  writeFileSync(join(project, "opencode.json"), JSON.stringify({
    plugins: [{ package: alone.installed, options: {} }],
    mcp: { servers: { granola: { type: "remote", url: OFFICIAL_URL, disabled: true } } },
  }, null, 2))
  const password = randomUUID()
  const port = await freePort()
  const full = { ...env, ...OFFLINE, ...QUIET, PATH: "/usr/bin:/bin", OPENCODE_PASSWORD: password }

  assert.equal(run(binary, ["--version"], root, full).trim(), `opencode v${version}`)
  const listed = run(binary, ["debug", "paths"], root, full).trim().split("\n").flatMap((line) => {
    const value = line.trim().split(/\s+/).slice(1).join(" ")
    return value ? [value] : []
  })
  assert.ok(listed.length >= 8, `opencode ${version} debug paths returned ${listed.length} entries`)
  assert.deepEqual(listed.filter((path) => !path.startsWith(root + sep)), [], `opencode ${version} debug paths`)
  let output = ""
  // The server's default location is its working directory, which is not the project: a call without a location then
  // proves rpc.unavailable, as `opencode api` run from elsewhere gets it.
  const server = spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: root, env: full, stdio: ["ignore", "pipe", "pipe"] })
  server.stdout.on("data", (chunk) => void (output += chunk))
  server.stderr.on("data", (chunk) => void (output += chunk))
  const exited = new Promise((done) => server.once("exit", done))

  const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
  async function api(method, path, body) {
    const url = new URL(path, `http://127.0.0.1:${port}`)
    url.searchParams.set("location[directory]", project)
    const response = await fetch(url, { method, headers: { authorization, "content-type": "application/json" }, body: body && JSON.stringify(body) })
    const text = await response.text()
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text.slice(0, 500)}`)
    return JSON.parse(text)
  }
  /** A request that may carry no location, or a header instead of the query, and whose error body the test reads. */
  async function raw(method, path, body, options = {}) {
    const url = new URL(path, `http://127.0.0.1:${port}`)
    if (options.location !== false) url.searchParams.set("location[directory]", project)
    const response = await fetch(url, { method, headers: { authorization, "content-type": "application/json", ...options.headers }, body: body && JSON.stringify(body) })
    return { status: response.status, text: await response.text() }
  }
  async function close() {
    if (server.exitCode === null && server.signalCode === null) {
      server.kill("SIGTERM")
      const timer = setTimeout(() => server.kill("SIGKILL"), 10_000)
      await exited
      clearTimeout(timer)
    }
  }
  /** Polls until `read` returns a value; plugins activate after the server answers. */
  async function until(what, read, ms = 180_000) {
    for (const deadline = Date.now() + ms; ;) {
      try {
        const value = await read()
        if (value !== undefined) return value
      } catch (error) {
        if (Date.now() > deadline) throw error
      }
      if (server.exitCode !== null || Date.now() > deadline) {
        throw new Error(`opencode ${version}: ${what} did not happen\n${output.slice(-3000)}`)
      }
      await sleep(500)
    }
  }
  /** Fails if OpenCode resolved its home or tmp folder outside the temp root. */
  async function isolated() {
    const paths = await until("a global paths read", async () => globalPaths(port, authorization, project))
    const inside = (path) => path !== undefined && path.startsWith(root + sep)
    assert.ok(inside(paths.home) && inside(paths.tmp), `opencode ${version} resolved its paths outside ${root}: ${JSON.stringify(paths)}`)
  }
  return { api, raw, project, close, until, isolated, log: () => output }
}

for (const version of HOST_VERSIONS) {
  test(`installed alone, it loads in stock opencode ${version} with its server and TUI parts, its RPC status and skills`, async () => {
    const host = await serve(version)
    try {
      const plugin = await host.until("plugin activation", async () => {
        const found = (await host.api("GET", "/api/plugin")).data.find((entry) => entry.id === "granola.meetings")
        return ["active", "failed"].includes(found?.state?.status) ? found : undefined
      })
      await host.isolated()
      assert.equal(plugin.state.status, "active", JSON.stringify(plugin.state))
      assert.deepEqual(plugin.features, { server: true, tui: true })

      const servers = await host.api("GET", "/api/mcp")
      assert.equal(servers.data.find((entry) => entry.name === "granola")?.status?.status, "disabled")
      const build = (await host.api("GET", "/api/agent")).data.find((agent) => agent.id === "build")
      assert.ok(build, "the build agent is listed")
      const base = build.permissions.findIndex((rule) => rule.action === "*" && rule.resource === "*" && rule.effect === "allow")
      assert.ok(base >= 0, "build has a base allow")
      assert.deepEqual(build.permissions[base + 1], { action: "granola_*", resource: "*", effect: "ask" })
      const block = build.permissions.slice(base + 1, base + 13)
      for (const action of ["granola_get_meetings", "granola_list_templates"]) {
        assert.ok(block.some((rule) => rule.action === action && rule.resource === "*" && rule.effect === "allow"), action)
      }

      const { output: status } = await host.api("POST", "/api/rpc/granola.meetings/status", { input: {} })
      assert.equal(status.state, "disabled")
      assert.equal(status.version, pkg.version)
      assert.deepEqual(status.host, { version, range: SUPPORTED_RANGE, tested: true })
      assert.equal(status.nextStep, 'Enable granola in /mcps, or remove "disabled": true from mcp.servers.granola in your OpenCode config.')
      assert.deepEqual(status.unguardedAgents, [])
      assert.equal(status.hostWarning, undefined)
      assert.equal(status.conflict, undefined)

      // The location: a call without one reaches the server's default location, where this project's plugin is not loaded.
      const missing = await host.raw("POST", "/api/rpc/granola.meetings.tools/describe", { input: {} }, { location: false })
      assert.equal(missing.status, 400)
      assert.ok(missing.text.includes("rpc.unavailable"), missing.text.slice(0, 300))
      const withHeader = await host.raw("POST", "/api/rpc/granola.meetings.tools/describe", { input: {} }, { location: false, headers: { "x-opencode-directory": host.project } })
      assert.equal(withHeader.status, 200)

      const skills = await host.until("skill registration", async () => {
        const ids = (await host.api("GET", "/api/skill")).data.map((skill) => skill.id)
        return SKILLS.every((id) => ids.includes(id)) ? ids : undefined
      })
      assert.deepEqual(skills.filter((id) => id.startsWith("granola")).sort(), SKILLS)
    } catch (error) {
      console.error(host.log().slice(-3000))
      throw error
    } finally {
      await host.close()
    }
  })
}

test("next to the host packages, '.' and './tui' import under Bun, and './rpc' is not exported", () => {
  const { dir } = consumer("with-host", HOST_PACKAGES.map((name) => `${name}@${pkg.devDependencies[name]}`))
  writeFileSync(join(dir, "probe.mjs"), [
    `const server = (await import(${JSON.stringify(pkg.name)})).default`,
    `const rpc = await import(${JSON.stringify(`${pkg.name}/rpc`)}).then(() => "exported", () => "not exported")`,
    `const tui = (await import(${JSON.stringify(`${pkg.name}/tui`)})).default`,
    "console.log(JSON.stringify({",
    "  server: { id: server.id, setup: typeof server.setup },",
    "  rpc,",
    "  tui: { id: tui.id, setup: typeof tui.setup },",
    "}))",
  ].join("\n"))
  const output = run("bun", ["probe.mjs"], dir)
  assert.deepEqual(JSON.parse(output.trim().split("\n").at(-1)), {
    server: { id: "granola.meetings", setup: "function" },
    rpc: "not exported",
    tui: { id: "granola.meetings.tui", setup: "function" },
  })
})
