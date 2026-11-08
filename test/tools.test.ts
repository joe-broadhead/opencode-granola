import { Error as ToolError } from "@opencode/plugin/promise/tool"
import { describe, expect, it } from "vitest"
import { NAMESPACE_DESCRIPTION, registerTools } from "../src/tools.js"
import { workspaceName } from "../src/workspace.js"
import { fakeHost, type FakeServer } from "./fakes.js"

const mcpTool = (name: string) => ({ id: `granola_${name}`, name, options: { namespace: "granola", codemode: true } })

async function setup() {
  const host = fakeHost({ baseTools: () => [mcpTool("get_meetings"), mcpTool("create_folder"), mcpTool("sign_out"), { id: "shell", name: "shell" }] })
  const state = await registerTools(host.ctx)
  return { host, state, after: host.hooks.get("execute.after")! }
}

describe("tool registry transform", () => {
  it("describes the granola namespace", async () => {
    const { host } = await setup()
    expect(host.namespaces.get("granola")).toBe(NAMESPACE_DESCRIPTION)
  })

  it("carries the rules every Granola answer needs, since it is always visible and the skills may not be loaded", () => {
    expect(NAMESPACE_DESCRIPTION).toContain("query_granola_meetings takes document_ids, not meeting_ids")
    expect(NAMESPACE_DESCRIPTION).toContain("as Granola's")
    expect(NAMESPACE_DESCRIPTION).toContain("in your own words unless the user asks for exact words")
    expect(NAMESPACE_DESCRIPTION.length).toBeLessThanOrEqual(400)
  })

  it("hides sign_out, counts it, and leaves every other tool alone across rebuilds", async () => {
    const { host, state } = await setup()
    host.rebuild()
    expect([...host.tools.keys()].sort()).toEqual(["granola_create_folder", "granola_get_meetings", "shell"])
    expect(host.tools.get("shell")).toEqual({ id: "shell", name: "shell" })
    expect(state.hidden()).toBe(1)
  })

  it("counts nothing hidden when the server offers no sign_out", async () => {
    const host = fakeHost({ baseTools: () => [mcpTool("get_meetings")] })
    const state = await registerTools(host.ctx)
    expect(state.hidden()).toBe(0)
  })
})

describe("execute.after", () => {
  const failure = (tool: string, message: string) => ({
    tool, sessionID: "ses_1", agent: "build", messageID: "msg_1", id: "call_1", input: {},
    status: "error" as const, error: new ToolError({ message }),
  })

  it("rewrites an unavailable-server failure into the current connection row", async () => {
    const { host, after } = await setup()
    host.listed.servers = [{ name: "granola", status: { status: "needs_auth", error: "go to https://auth.example/x" } }]
    const event = failure("granola_get_meetings", 'MCP server "granola" needs authentication: go to https://auth.example/x. Sign in from /mcps.')
    await after(event)
    expect(event.error).toBeInstanceOf(ToolError)
    expect(event.error.message).toBe("AUTH_REQUIRED: Granola needs you to sign in. Next step: Run /connect and choose Granola, then press o or Enter to open the sign-in page (in a terminal, opencode mcp auth granola opens it automatically).")
    expect(event.error.metadata).toEqual({ code: "AUTH_REQUIRED", next: expect.any(String) })
  })

  it.each([
    [[], "NOT_REGISTERED"],
    [[{ name: "granola", status: { status: "disabled" } }], "DISABLED"],
    [[{ name: "granola", status: { status: "failed", error: "timeout" } }], "CONNECTION_FAILED"],
    [[{ name: "granola", status: { status: "connected" } }], "CONNECTING"],
  ] satisfies [FakeServer[], string][])("maps the live state %j to %s", async (servers, code) => {
    const { host, after } = await setup()
    host.listed.servers = servers
    const event = failure("granola_create_folder", 'MCP server "granola" is not available')
    await after(event)
    expect(event.error.metadata).toMatchObject({ code })
  })

  it("leaves Granola's own errors, permission errors and other tools unchanged", async () => {
    const { host, after } = await setup()
    host.listed.servers = [{ name: "granola", status: { status: "needs_auth", error: "x" } }]
    for (const event of [
      failure("granola_get_meetings", "Meeting not found"),
      failure("granola_create_folder", "Permission denied: granola_create_folder"),
      failure("shell", 'MCP server "granola" is not available'),
      failure("granola_export_markdown", 'MCP server "granola" is not available'),
    ]) {
      const original = event.error
      await after(event)
      expect(event.error).toBe(original)
    }
  })

  // R19: the export folder is outside the project, so OpenCode asks for external_directory as well as its action.
  it("gives an external_directory refusal of the export the rule as its next step", async () => {
    const host = fakeHost({ baseTools: () => [mcpTool("get_meetings")] })
    await registerTools(host.ctx, "/data/Granola")
    const after = host.hooks.get("execute.after")!
    const event = failure("granola_export_markdown", "permission.rejected: external_directory")
    await after(event)
    expect(event.error).toBeInstanceOf(ToolError)
    expect(event.error.message).toContain("EXPORT_PATH_NOT_PERMITTED:")
    expect(event.error.message).toContain('{ "action": "external_directory", "resource": "/data/Granola/*", "effect": "allow" }')
    expect(event.error.metadata).toMatchObject({ code: "EXPORT_PATH_NOT_PERMITTED" })
  })

  it("keeps the host's error when the connection state cannot be read", async () => {
    const { host, after } = await setup()
    host.ctx.mcp.list = async () => { throw new Error("offline") }
    const event = failure("granola_get_meetings", 'MCP server "granola" is not available')
    const original = event.error
    await after(event)
    expect(event.error).toBe(original)
  })

  it("remembers the active workspace name from a successful account read, in memory only", async () => {
    const { after, state } = await setup()
    expect(state.workspace()).toBeUndefined()
    const account = { email: "someone@example.test", active_workspace: { id: "w1", display_name: "Acme" }, workspaces: [] }
    await after({ tool: "granola_get_account_info", status: "completed", result: { output: account } })
    expect(state.workspace()).toBe("Acme")
    await after({ tool: "granola_get_account_info", status: "completed", result: { output: "not json" } })
    expect(state.workspace()).toBe("Acme")
    await after({ tool: "granola_list_meetings", status: "completed", result: { output: { active_workspace: { display_name: "Other" } } } })
    expect(state.workspace()).toBe("Acme")
  })
})

describe("workspaceName", () => {
  it("reads only active_workspace.display_name from object, JSON text or content", () => {
    const account = { email: "someone@example.test", active_workspace: { id: "w1", display_name: "  Acme\n Corp " } }
    expect(workspaceName({ output: account })).toBe("Acme Corp")
    expect(workspaceName({ output: JSON.stringify(account) })).toBe("Acme Corp")
    expect(workspaceName({ content: [{ type: "text", text: JSON.stringify(account) }] })).toBe("Acme Corp")
    expect(workspaceName({ output: { email: "someone@example.test" } })).toBeUndefined()
    expect(workspaceName({ output: { active_workspace: { display_name: "" } } })).toBeUndefined()
    expect(workspaceName({ output: { active_workspace: { display_name: "x".repeat(200) } } })).toHaveLength(80)
  })
})
