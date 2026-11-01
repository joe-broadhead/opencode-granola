import { readFileSync } from "node:fs"
import ts from "typescript"
import { describe, expect, it } from "vitest"
import plugin from "../src/index.js"
import { setup } from "../src/setup.js"
import { Granola, STATUS_SCHEMA } from "../src/rpc/contract.js"
import { formatStatus, type Status } from "../src/status.js"
import { fakeHost } from "./fakes.js"

describe("status RPC", () => {
  it("defines exactly one method, status, with no events", () => {
    expect(Granola.id).toBe("granola.meetings")
    expect(Object.keys(Granola.methods)).toEqual(["status"])
    expect(Granola.methods.status.output).toBe(STATUS_SCHEMA)
    expect(Granola.methods.status.input).toEqual({ type: "object", properties: {}, additionalProperties: false })
    expect(Granola.events).toEqual({})
  })

  it("keeps the contract free of server code, so clients can load it alone", () => {
    const path = new URL("../src/rpc/contract.ts", import.meta.url)
    const source = ts.createSourceFile(path.pathname, readFileSync(path, "utf8"), ts.ScriptTarget.Latest)
    const imports = source.statements.flatMap((node) =>
      ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) ? [node.moduleSpecifier.text] : [])
    expect(imports).toEqual(["@opencode/plugin/rpc"])
  })

  it("is registered by setup and serves the status model that /granola-status prints", async () => {
    const host = fakeHost()
    await setup(host.ctx)
    host.listed.servers = [{ name: "granola", title: "Granola", status: { status: "needs_auth", error: "see https://auth.example/x" } }]
    const handlers = host.rpc.get(Granola.id)!
    expect(Object.keys(handlers)).toEqual(["status"])
    const served = await handlers.status!({}, {}) as Status
    await host.commands.get("granola-status")!.execute({ sessionID: "ses_1", delivery: "queue", prompt: {} })
    expect(host.synthetic[0]).toMatchObject({ text: formatStatus(served) })
    expect(served).toMatchObject({ state: "needs_auth", problem: { code: "AUTH_REQUIRED" } })
    expect(JSON.stringify(served)).not.toContain("auth.example")
  })
})
