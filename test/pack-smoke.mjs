// Packs the repository, installs the packed tarball, starts it in the stock OpenCode 2.4.1 host, and proves
// `opencode plugin add` accepts the same tarball.
//
//   npm run test:pack
//
// OpenCode 2.4.1's `plugin add` refuses a `file:` or plain local path ("Plugin target must be an npm registry package
// or Git package specifier"), and its Git dependency preparation fails in this embedded build. The test therefore
// serves the exact packed tarball from a loopback npm registry for `plugin add`, and starts a second install from the
// tarball's local path in the project configuration. Both use the same bytes `npm pack` produced.
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { createServer } from "node:http"
import { createServer as createNetServer } from "node:net"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { arch, platform } from "node:os"
import { join, relative, sep } from "node:path"
import { after, test } from "node:test"
import { setTimeout as sleep } from "node:timers/promises"

const ROOT = realpathSync(new URL("..", import.meta.url))
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))
const WORK = realpathSync(mkdtempSync(join(realpathSync("/tmp"), "granola-pack-")))
const OFFLINE = {
  HTTP_PROXY: "http://127.0.0.1:9",
  HTTPS_PROXY: "http://127.0.0.1:9",
  http_proxy: "http://127.0.0.1:9",
  https_proxy: "http://127.0.0.1:9",
  NO_PROXY: "127.0.0.1,localhost",
  no_proxy: "127.0.0.1,localhost",
}
const QUIET = { OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_DISABLE_AUTOUPDATE: "1", OPENCODE_DISABLE_FREE_MODELS: "1" }

after(() => rmSync(WORK, { recursive: true, force: true }))

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env: { ...env, npm_config_update_notifier: "false" } })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status}):\n${result.stderr}\n${result.stdout}`)
  return result.stdout
}

/** A command run without blocking the event loop, so an in-process registry can answer it. */
function runAsync(command, args, cwd, env = process.env, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...env, npm_config_update_notifier: "false" }, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      reject(new Error(`${command} ${args.join(" ")} timed out after ${timeoutMs} ms`))
    }, timeoutMs)
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on("exit", (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(stdout)
      else reject(new Error(`${command} ${args.join(" ")} failed (${code}):\n${stderr}\n${stdout}`))
    })
  })
}

const tree = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((item) => item.isFile() && item.name !== ".DS_Store")
    .map((item) => relative(dir, join(item.parentPath, item.name)).split(sep).join("/"))

function expectedFiles() {
  return [
    "package.json",
    ...pkg.files.flatMap((entry) => {
      const full = join(ROOT, entry)
      assert.ok(existsSync(full), `${entry} from the files list exists`)
      return statSync(full).isDirectory() ? tree(full).map((path) => `${entry}/${path}`) : [entry]
    }),
  ].sort()
}

/** The stock OpenCode 2.4.1 binary: OPENCODE_BIN_2_4_1, else the one on PATH, else the npm release. */
function opencodeBinary() {
  const given = process.env["OPENCODE_BIN_2_4_1"]
  if (given) {
    assert.ok(existsSync(given), `OPENCODE_BIN_2_4_1 points at ${given}`)
    return given
  }
  const onPath = spawnSync("opencode", ["--version"], { encoding: "utf8" })
  if (onPath.status === 0 && onPath.stdout.includes("2.4.1")) return "opencode"
  const dir = join(WORK, "opencode-cli")
  mkdirSync(dir)
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "granola-pack-cli", private: true }))
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "@opencode/cli@2.4.1"], dir)
  const path = join(dir, "node_modules", "@opencode", `cli-${platform()}-${arch()}`, "bin", "opencode")
  assert.ok(existsSync(path), `@opencode/cli@2.4.1 has a binary for ${platform()}-${arch()}`)
  return path
}

async function freePort() {
  const server = createNetServer()
  await new Promise((done) => server.listen(0, "127.0.0.1", done))
  const { port } = server.address()
  await new Promise((done) => server.close(done))
  return port
}

/** A loopback npm registry that serves exactly the packed tarball under its package name. */
async function registry(tarballPath) {
  const bytes = readFileSync(tarballPath)
  const shasum = createHash("sha1").update(bytes).digest("hex")
  const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`
  const encoded = pkg.name.replace("/", "%2f")
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    if (url.pathname === `/${encoded}` || url.pathname === `/${pkg.name}`) {
      const version = { ...pkg, dist: { tarball: `http://127.0.0.1:${server.address().port}/package.tgz`, shasum, integrity } }
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ name: pkg.name, "dist-tags": { latest: pkg.version }, versions: { [pkg.version]: version } }))
      return
    }
    if (url.pathname === "/package.tgz") {
      response.writeHead(200, { "content-type": "application/octet-stream", "content-length": bytes.length }).end(bytes)
      return
    }
    response.writeHead(404).end()
  })
  await new Promise((done) => server.listen(0, "127.0.0.1", done))
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((done) => server.close(done)) }
}

/** A server in the temporary home, with auth and no model or update traffic. */
async function serve(binary, project, home) {
  const password = randomUUID()
  const port = await freePort()
  const env = {
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    XDG_CACHE_HOME: join(home, ".cache"),
    TMPDIR: join(home, "tmp"),
    PATH: "/usr/local/bin:/usr/bin:/bin",
    OPENCODE_PASSWORD: password,
    ...OFFLINE,
    ...QUIET,
  }
  for (const dir of [env.HOME, env.XDG_CONFIG_HOME, env.XDG_DATA_HOME, env.XDG_STATE_HOME, env.XDG_CACHE_HOME, env.TMPDIR]) mkdirSync(dir, { recursive: true })
  const child = spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: project, env, stdio: ["ignore", "pipe", "pipe"] })
  let output = ""
  child.stdout.on("data", (chunk) => {
    output += chunk
  })
  child.stderr.on("data", (chunk) => {
    output += chunk
  })
  const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
  const api = async (path) => {
    const response = await fetch(new URL(path, `http://127.0.0.1:${port}`), { headers: { authorization } })
    const text = await response.text()
    if (!response.ok) throw new Error(`${path}: ${response.status} ${text.slice(0, 300)}`)
    return JSON.parse(text)
  }
  return {
    api,
    async until(what, read, ms = 120_000) {
      for (const deadline = Date.now() + ms; ;) {
        const value = await read().catch(() => undefined)
        if (value !== undefined) return value
        if (child.exitCode !== null || Date.now() > deadline) throw new Error(`${what} did not happen\n${output.slice(-3000)}`)
        await sleep(400)
      }
    },
    async close() {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM")
        await new Promise((done) => child.once("exit", done))
      }
    },
    log: () => output,
  }
}

test("the packed tarball installs, is added by opencode plugin add, and starts in OpenCode 2.4.1", async () => {
  const binary = opencodeBinary()
  assert.match(run(binary, ["--version"], WORK).trim(), /opencode v2\.4\.1/)

  // Build and pack exactly what a release would.
  run("npm", ["run", "bundle"], ROOT)
  const packed = JSON.parse(run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", WORK], ROOT))[0]
  const tarballPath = join(WORK, packed.filename)
  assert.ok(existsSync(tarballPath))
  assert.deepEqual(packed.files.map((file) => file.path).sort(), expectedFiles())
  assert.deepEqual(
    packed.files.map((file) => file.path).filter((path) => /\.(?:tsx?|jsx|map)$|(?:^|\/)node_modules\//.test(path)),
    [],
    "the tarball carries no source, map or dependency files",
  )
  console.log(`# ${packed.filename}: ${packed.entryCount} files, ${packed.size} bytes packed, ${packed.unpackedSize} unpacked`)

  // A consumer project installs the tarball alone, with scripts off.
  const consumer = join(WORK, "consumer")
  mkdirSync(consumer)
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "granola-pack-consumer", private: true, type: "module" }))
  run("npm", ["install", tarballPath, "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline"], consumer)
  const installed = join(consumer, "node_modules", ...pkg.name.split("/"))
  const installedPackage = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"))
  assert.equal(installedPackage.name, pkg.name)
  assert.equal(installedPackage.version, pkg.version)
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies", "peerDependenciesMeta", "bundleDependencies", "bundledDependencies"]) {
    assert.equal(installedPackage[field], undefined, `${field} is not declared`)
  }
  for (const script of ["preinstall", "install", "postinstall", "prepare", "prepack", "postpack"]) {
    assert.equal(installedPackage.scripts?.[script], undefined, `${script} is not declared`)
  }
  assert.deepEqual(readdirSync(join(consumer, "node_modules")).filter((name) => name !== ".package-lock.json"), [pkg.name.split("/")[0]])
  assert.equal(existsSync(join(installed, "dist", "index.js")), true)
  assert.equal(existsSync(join(installed, "NOTICE")), true, "the tarball carries the bundled licence NOTICE")
  assert.match(readFileSync(join(installed, "NOTICE"), "utf8"), /^## yaml 2\.9\.1 \(ISC\)$/m, "the NOTICE names the bundled yaml version and licence")

  // `opencode plugin add` installs the same tarball from a loopback registry.
  console.log("# installing through opencode plugin add")
  const home = join(WORK, "home")
  const addProject = join(WORK, "add-project")
  mkdirSync(addProject)
  run("git", ["init", "--quiet", addProject], addProject)
  const local = await registry(tarballPath)
  try {
    const addEnv = { ...process.env, ...OFFLINE, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), NPM_CONFIG_REGISTRY: local.url, PATH: "/usr/local/bin:/usr/bin:/bin" }
    const added = await runAsync(binary, ["plugin", "add", `${pkg.name}@${pkg.version}`], addProject, addEnv)
    assert.match(added, /installed and added/)
    const config = JSON.parse(readFileSync(join(home, ".config", "opencode", "opencode.json"), "utf8"))
    assert.deepEqual(config.plugins, [`${pkg.name}@${pkg.version}`])
  } finally {
    await local.close()
  }

  // A project that loads the installed tarball by local path starts it in the stock host.
  console.log("# starting the installed tarball in OpenCode 2.4.1")
  const startProject = join(WORK, "start-project")
  mkdirSync(startProject)
  run("git", ["init", "--quiet", startProject], startProject)
  writeFileSync(
    join(startProject, "opencode.json"),
    JSON.stringify({ plugins: [{ package: installed, options: { accounts: { work: {}, personal: {} } } }] }, null, 2),
  )
  const host = await serve(binary, startProject, join(WORK, "start-home"))
  try {
    const plugin = await host.until("plugin activation", async () => {
      const found = (await host.api("/api/plugin")).data.find((entry) => entry.id === "granola")
      return found === undefined ? undefined : found
    })
    assert.equal(plugin.state.status, "active", JSON.stringify(plugin.state))
    assert.equal(plugin.source.type, "local")
    const servers = await host.until("the per-alias MCP servers", async () => {
      const found = (await host.api("/api/mcp")).data
      return found.some((entry) => entry.name === "granola-work") && found.some((entry) => entry.name === "granola-personal") ? found : undefined
    })
    assert.deepEqual(servers.map((entry) => entry.name).filter((name) => name.startsWith("granola")).sort(), ["granola-personal", "granola-work"])
  } finally {
    await host.close()
  }
})
