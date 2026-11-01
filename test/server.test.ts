import { describe, expect, it } from "vitest"
import { OFFICIAL_URL, registerServer } from "../src/server.js"
import { fakeHost } from "./fakes.js"

describe("Granola MCP registration", () => {
  it("registers only the official remote URL under the name granola", async () => {
    const host = fakeHost({ baseServers: () => [["github", { type: "remote", url: "https://example.test/mcp" }]] })
    const server = await registerServer(host.ctx)
    expect(host.servers.get("granola")).toEqual({ type: "remote", url: OFFICIAL_URL })
    expect(host.servers.get("github")).toEqual({ type: "remote", url: "https://example.test/mcp" })
    expect(server.conflict()).toBeUndefined()
    host.rebuild()
    expect(host.servers.get("granola")).toEqual({ type: "remote", url: OFFICIAL_URL })
  })

  it("leaves a user's own official entry alone, including disabled and timeout settings", async () => {
    const own = { type: "remote", url: OFFICIAL_URL, disabled: true, timeout: { execution: 60_000 } }
    const host = fakeHost({ baseServers: () => [["granola", structuredClone(own)]] })
    const server = await registerServer(host.ctx)
    expect(host.servers.get("granola")).toEqual(own)
    expect(server.conflict()).toBeUndefined()
  })

  it.each([
    ["another URL", { type: "remote", url: "https://example.test/granola" }],
    ["a local command", { type: "local", command: ["node", "server.js"] }],
  ])("never overwrites an entry for %s and reports the conflict", async (_label, entry) => {
    const host = fakeHost({ baseServers: () => [["granola", structuredClone(entry)]] })
    const server = await registerServer(host.ctx)
    expect(host.servers.get("granola")).toEqual(entry)
    expect(server.conflict()).toContain("mcp.servers.granola")
    expect(server.conflict()).not.toContain("example.test")
  })

  it("clears the conflict on a rebuild after the user removes their entry", async () => {
    let entries: [string, Record<string, unknown>][] = [["granola", { type: "local", command: ["node"] }]]
    const host = fakeHost({ baseServers: () => structuredClone(entries) })
    const server = await registerServer(host.ctx)
    expect(server.conflict()).toBeDefined()
    entries = []
    host.rebuild()
    expect(server.conflict()).toBeUndefined()
    expect(host.servers.get("granola")).toEqual({ type: "remote", url: OFFICIAL_URL })
  })
})
