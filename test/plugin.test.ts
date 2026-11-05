import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { describe, expect, it } from "vitest"
import plugin from "../src/index.js"
import { setup } from "../src/setup.js"
import { readPackageInfo } from "../src/meta.js"
import { DEFAULT_RULES } from "../src/permissions.js"
import { OFFICIAL_URL } from "../src/server.js"
import type { Status } from "../src/rpc/contract.js"
import { agent, fakeHost } from "./fakes.js"

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))

async function rejection(promise: Promise<unknown>): Promise<Error & { code?: string }> {
  try { await promise } catch (error) { return error as Error } 
  throw new Error("expected setup to fail")
}

describe("plugin definition", () => {
  it("keeps the stable id and defines no image", () => {
    expect(plugin.id).toBe("granola.meetings")
    expect(Object.keys(plugin).sort()).toEqual(["id", "setup"])
  })

  it("registers the server, the permission defaults, the status command and the skills", async () => {
    const host = fakeHost({ baseAgents: () => [agent("build")] })
    await setup(host.ctx, host.toolsRpc)
    expect(host.servers.get("granola")).toEqual({ type: "remote", url: OFFICIAL_URL })
    expect(host.agents.get("build")!.permissions.slice(1, 1 + DEFAULT_RULES.length)).toEqual(DEFAULT_RULES)
    expect([...host.commands.keys()]).toEqual(["granola-status"])
    expect(host.skills.size).toBeGreaterThan(0)
    expect(host.hooks.has("execute.after")).toBe(true)
  })

  it("serves status with the package version, the host version and the export directory", async () => {
    const host = fakeHost({ options: { exportDirectory: "/data/Granola" } })
    await setup(host.ctx, host.toolsRpc)
    host.listed.servers = [{ name: "granola", status: { status: "pending" } }]
    const result = await host.rpc.get("granola.meetings")!.status!({}, {}) as Status
    expect(result).toMatchObject({
      version: pkg.version,
      host: { version: "2.2.3", range: ">=2.2.3 <2.3.0", tested: true },
      state: "connecting",
      exportDirectory: "/data/Granola",
      nextStep: "Retry in a few seconds.",
    })
  })

  it("sets everything up on a release inside the range that is not tested, and calls it untested", async () => {
    const host = fakeHost({ version: "2.2.6" })
    await setup(host.ctx, host.toolsRpc)
    expect(host.servers.size).toBe(1)
    host.listed.servers = [{ name: "granola", status: { status: "connected" } }]
    const result = await host.rpc.get("granola.meetings")!.status!({}, {}) as Status
    expect(result).toMatchObject({ state: "connected", host: { version: "2.2.6", tested: false }, nextStep: "Nothing to do." })
    expect(result.hostWarning).toBeUndefined()
  })

  it.each(["2.3.0", "2.2.2", "0.0.0-dev-202610301200"])("refuses OpenCode %s with HOST_UNTESTED before registering anything", async (version) => {
    const host = fakeHost({ version })
    const error = await rejection(Promise.resolve(setup(host.ctx, host.toolsRpc)))
    expect(error.code).toBe("HOST_UNTESTED")
    expect(error.message).toContain(`found ${version}`)
    expect(host.servers.size).toBe(0)
  })

  it("loads on an untested host with allowUntestedHost and warns in status", async () => {
    const host = fakeHost({ version: "2.3.0", options: { allowUntestedHost: true } })
    await setup(host.ctx, host.toolsRpc)
    const result = await host.rpc.get("granola.meetings")!.status!({}, {}) as Status
    expect(result.hostWarning).toContain("outside the supported range >=2.2.3 <2.3.0")
    expect(result.host).toEqual({ version: "2.3.0", range: ">=2.2.3 <2.3.0", tested: false })
    host.listed.servers = [{ name: "granola", status: { status: "connected" } }]
    const connected = await host.rpc.get("granola.meetings")!.status!({}, {}) as Status
    expect(connected).toMatchObject({ state: "connected", nextStep: "If Granola misbehaves, use OpenCode 2.2.3, 2.2.4 or 2.2.5." })
  })

  it("fails setup with one error that names a bad option", async () => {
    const host = fakeHost({ options: { exportRoots: ["/x"] } })
    const error = await rejection(Promise.resolve(setup(host.ctx, host.toolsRpc)))
    expect(error.code).toBe("OPTIONS_INVALID")
    expect(error.message).toContain("exportRoots is not supported")
  })
})

describe("package metadata", () => {
  it("reads the version and the tested OpenCode line from package.json", () => {
    expect(readPackageInfo()).toEqual({ version: pkg.version, hostRange: pkg.opencode.host })
    expect(pkg.opencode.host).toBe(">=2.2.3 <2.3.0")
  })

  it("refuses a package.json without the tested line", () => {
    const directory = mkdtempSync(join(tmpdir(), "granola-pkg-"))
    try {
      writeFileSync(join(directory, "package.json"), JSON.stringify({ version: pkg.version }))
      expect(() => readPackageInfo(pathToFileURL(join(directory, "package.json")))).toThrow("opencode.host")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
