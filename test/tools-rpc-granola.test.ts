// Granola's part of the tools RPC: the plugin-specific block of src/host/tools-rpc.ts, and how setup registers it. The
// shared part is tested in tools-rpc.test.ts.
import { Error as ToolError } from "@opencode/plugin/promise/tool"
import { describe, expect, it } from "vitest"
import { connectionProblem, toolUnavailable } from "../src/errors.js"
import { METHODS, NEXT_STEPS, shapeResult, TOOLS_RPC_ID } from "../src/host/tools-rpc.js"
import { HIDDEN_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../src/known-tools.js"
import { Granola } from "../src/rpc/contract.js"
import { setup } from "../src/setup.js"
import type { ConnectionState, Status } from "../src/rpc/contract.js"
import { CONFLICT_NEXT } from "../src/status.js"
import { agent, fakeHost, type FakeHost, type FakeServer } from "./fakes.js"

type Handler = (input: unknown, context: unknown) => Promise<any>

const ACCOUNT = { active_workspace: { id: "w1", display_name: "Acme" } }
const text = (value: unknown) => [{ type: "text", text: JSON.stringify(value) }]
const context = () => ({ signal: new AbortController().signal, error: (type: string, message: string, data: unknown) => ({ type, message, data }) })

/** Setup on the fake host, with a build session, Granola connected, and every Granola tool OpenCode would list. */
async function started(options: { servers?: [string, Record<string, unknown>][] } = {}) {
  const host = fakeHost({ baseAgents: () => [agent("build")], ...(options.servers ? { baseServers: () => options.servers! } : {}) })
  const stop = await setup(host.ctx, host.toolsRpc)
  host.listed.agents = [...host.agents.values()]
  host.listed.servers = [{ name: "granola", status: { status: "connected" } }]
  host.sessions.set("ses_1", { agent: "build" })
  const ran: string[] = []
  for (const name of [...READ_TOOLS, ...WRITE_TOOLS, "brand_new_tool"]) {
    host.tools.set(`granola_${name}`, {
      id: `granola_${name}`,
      name,
      execute: async () => {
        ran.push(name)
        return name === "get_account_info" ? { output: ACCOUNT, content: text(ACCOUNT) } : { content: text({ ok: true }) }
      },
    })
  }
  const handlers = host.rpc.get(TOOLS_RPC_ID) as Record<string, Handler>
  const call = (method: string, input: unknown = {}, sessionID = "ses_1") => handlers[method]!({ sessionID, input }, context())
  const status = () => host.rpc.get(Granola.id)!.status!({}, {}) as Promise<Status>
  return { host, stop, handlers, call, status, ran }
}

/** What the model path's hook makes of a call to a server that is not connected, in the same connection state. */
async function hookError(host: FakeHost, tool: string, message: string) {
  const event = { tool, status: "error" as const, error: new ToolError({ message }) }
  await host.hooks.get("execute.after")!(event)
  return event.error.metadata as { code: string; next: string }
}

describe("Granola's tools RPC", () => {
  it("is granola.meetings.tools, with every known tool a method and its class", async () => {
    expect(TOOLS_RPC_ID).toBe("granola.meetings.tools")
    expect(METHODS.map(method => [method.name, method.class])).toEqual([
      ...READ_TOOLS.map(name => [name, "read"]),
      ...WRITE_TOOLS.map(name => [name, name === "give_feedback" ? "send" : "write"]),
    ])
    const { handlers } = await started()
    expect(Object.keys(handlers).sort()).toEqual(["describe", "events_list", "export_markdown", ...READ_TOOLS, ...WRITE_TOOLS].sort())
    // sign_out is not a tool this plugin offers (it removes it), so it is not a method; an unknown tool never is.
    for (const name of [...HIDDEN_TOOLS, "brand_new_tool"]) expect({ name, method: handlers[name] }).toEqual({ name, method: undefined })
  })

  it("reports each method's class, events_list included, and an export that writes a local file", async () => {
    const { call } = await started()
    const description = (await call("describe", {})) as { methods: { name: string; class: string }[] }
    const classes = Object.fromEntries(description.methods.map((method) => [method.name, method.class]))
    expect(classes).toMatchObject({ get_meetings: "read", create_folder: "write", give_feedback: "send", export_markdown: "export", events_list: "read" })
    const exported = description.methods.find((method) => method.name === "export_markdown") as unknown as { action: string; output: { properties: Record<string, object> } }
    expect(exported).toMatchObject({ action: "granola_export_markdown" })
    // OpenCode's RPC output validation refuses a pattern, so the method's schema has none; the tool still checks its own.
    for (const property of Object.values(exported.output.properties)) expect(property).not.toHaveProperty("pattern")
  })

  it("runs a write at the default access, and refuses one the session's own rules ask for", async () => {
    const { call, ran, host } = await started()
    expect(await call("create_folder", { title: "New" })).toEqual({ text: JSON.stringify({ ok: true }) })
    expect(ran).toEqual(["create_folder"])
    // A session rule of the user's own, in the same shape a restricted access value gives.
    host.sessions.set("ses_careful", { agent: "build", permissions: [{ action: "granola_update_folder", resource: "*", effect: "ask" }] })
    expect(await call("update_folder", { folder_id: "f-1", title: "Renamed" }, "ses_careful")).toMatchObject({ type: "failed", data: { code: "PERMISSION_DENIED" } })
    expect(ran).toEqual(["create_folder"])
  })

  it("runs a read as the session's agent and returns its structured content and text", async () => {
    const { call, ran } = await started()
    expect(await call("search_meetings", { limit: 1 })).toEqual({ text: JSON.stringify({ ok: true }) })
    expect(ran).toEqual(["search_meetings"])
  })

  it("records the workspace from an account read, as the hook does on the model path", async () => {
    const { call, status } = await started()
    expect((await status()).workspace).toBeUndefined()
    expect(await call("get_account_info")).toEqual({ output: ACCOUNT, text: JSON.stringify(ACCOUNT) })
    expect((await status()).workspace).toBe("Acme")
  })

  it("leaves results unchanged, and reads the workspace only from get_account_info", () => {
    const result = { output: { active_workspace: { display_name: "Other" } }, text: "" }
    expect(shapeResult("search_meetings", result, { sessionID: "s", agent: "a", action: "x" })).toBe(result)
    expect(shapeResult("get_account_info", result, { sessionID: "s", agent: "a", action: "x" })).toBe(result)
  })

  it("stops recording the workspace once the plugin is cleaned up, and disposes the RPC and its hook", async () => {
    const { host, stop, call, status } = await started()
    await stop()
    expect(host.rpc.has(TOOLS_RPC_ID)).toBe(false)
    expect(host.evaluate).toBeUndefined()
    // The status RPC is the host's to drop; its state no longer hears script reads.
    await call("get_account_info").catch(() => undefined)
    expect((await status()).workspace).toBeUndefined()
  })

  it("refuses a read that the agent's rules hide, before it runs", async () => {
    const { host, call, ran } = await started()
    host.listed.agents = [agent("build", { action: "granola_*", resource: "*", effect: "deny" })]
    expect(await call("get_meetings", { meeting_ids: ["m-1"] })).toMatchObject({ type: "failed", data: { code: "PERMISSION_DENIED" } })
    expect(ran).toEqual([])
  })

  it.each([
    ["pending", "CONNECTING"],
    ["needs_auth", "AUTH_REQUIRED"],
    ["failed", "CONNECTION_FAILED"],
    ["disabled", "DISABLED"],
    ["absent", "NOT_REGISTERED"],
    // The call found the server not connected, and it reads connected again: it reconnected meanwhile.
    ["connected", "CONNECTING"],
  ] satisfies [ConnectionState, string][])(
    "names a %s server with the model path's code and next step (%s)",
    async (state, code) => {
      const { host, call } = await started()
      host.listed.servers = state === "absent" ? [] : [{ name: "granola", status: state === "failed" ? { status: state, error: "timeout" } : { status: state } } as FakeServer]
      if (state !== "connected") {
        const expected = connectionProblem(state)!
        // The executor is gone while the server is not connected.
        host.tools.delete("granola_get_meetings")
        expect(await call("get_meetings")).toMatchObject({ type: "failed", data: { code: expected.code, next: expected.next } })
      }
      // A call that reaches a server that dropped meanwhile gets the same answer as the hook gives the model.
      host.tools.set("granola_get_meetings", { id: "granola_get_meetings", name: "get_meetings", execute: async () => { throw new Error('MCP server "granola" is not available') } })
      const model = await hookError(host, "granola_get_meetings", 'MCP server "granola" is not available')
      expect(model.code).toBe(code)
      expect(await call("get_meetings")).toMatchObject({ type: "failed", data: model })
    },
  )

  it("names a read the connected server does not list as TOOL_UNAVAILABLE, with Granola's next step", async () => {
    const { host, call } = await started()
    host.tools.delete("granola_get_meeting_transcript")
    expect(await call("get_meeting_transcript", { meeting_id: "m-1" })).toMatchObject({ type: "failed", data: { code: "TOOL_UNAVAILABLE", next: toolUnavailable("get_meeting_transcript").next } })
  })

  it("gives Granola's own error as UPSTREAM_ERROR, cut to its first line", async () => {
    const { host, call } = await started()
    const upstream = Object.assign(new ToolError({ message: "Meeting not found\nsecond line" }), { _tag: "Tool.Error" })
    host.tools.set("granola_get_meetings", { id: "granola_get_meetings", name: "get_meetings", execute: async () => { throw upstream } })
    const result = await call("get_meetings", { meeting_ids: ["m-2"] })
    expect(result).toMatchObject({ type: "failed", data: { code: "UPSTREAM_ERROR" } })
    expect(result.message).toContain("Meeting not found")
    expect(result.message).not.toContain("second line")
  })

  it("refuses every read while the user's own granola server, for another URL, holds the name", async () => {
    const { call, ran } = await started({ servers: [["granola", { type: "remote", url: "https://mcp.example.invalid/mcp" }]] })
    expect(await call("get_meetings")).toMatchObject({ type: "failed", data: { code: "SERVER_CONFLICT", next: CONFLICT_NEXT } })
    expect(ran).toEqual([])
  })

  it("adopts the user's own granola server for the official URL", async () => {
    const { call } = await started({ servers: [["granola", { type: "remote", url: "https://mcp.granola.ai/mcp" }]] })
    expect(await call("search_meetings")).toEqual({ text: JSON.stringify({ ok: true }) })
  })

  it("takes its next steps from Granola's connection table and status", () => {
    expect(NEXT_STEPS.AUTH_REQUIRED).toBe(connectionProblem("needs_auth")!.next)
    expect(NEXT_STEPS.SERVER_CONFLICT).toBe(CONFLICT_NEXT)
    expect(NEXT_STEPS.TOOL_UNAVAILABLE).toBe(toolUnavailable("get_meetings").next)
    expect(NEXT_STEPS.ACCOUNT_UNKNOWN).toBeUndefined()
  })
})
