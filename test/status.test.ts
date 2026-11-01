import { describe, expect, it } from "vitest"
import type { ConnectionState } from "../src/errors.js"
import { DEFAULT_RULES, insertDefaults } from "../src/permissions.js"
import { readPackageInfo } from "../src/meta.js"
import { CONFLICT_NEXT, STATUS_SCHEMA, agentFix, buildStatus, createStatus, formatStatus, type StatusInputs } from "../src/status.js"
import { agent, fakeHost } from "./fakes.js"

const VERSION = readPackageInfo().version

const guarded = () => {
  const built = agent("build")
  insertDefaults(built.permissions)
  return built
}

function inputs(overrides: Partial<StatusInputs> = {}): StatusInputs {
  return {
    servers: [{ name: "granola", title: "Granola", status: { status: "connected" } }],
    tools: ["granola_get_meetings", "granola_list_meetings", "granola_create_folder", "granola_export_markdown", "shell"].map((id) => ({ id })),
    agents: [guarded()],
    hidden: 1,
    exportDirectory: "/home/someone/Granola",
    pluginVersion: VERSION,
    host: { version: "2.2.3", tested: ">=2.2.3 <2.3.0" },
    ...overrides,
  }
}

describe("status model", () => {
  it("reports a connected server with tool counts, versions and the next step", () => {
    const status = buildStatus(inputs({ workspace: "Acme" }))
    expect(status).toEqual({
      state: "connected",
      title: "Granola",
      tools: { visible: 3, hidden: 1, unknown: 0, unknownNames: [] },
      workspace: "Acme",
      unguardedAgents: [],
      exportDirectory: "/home/someone/Granola",
      pluginVersion: VERSION,
      hostVersion: "2.2.3",
      next: "Nothing to do.",
    })
  })

  it.each<[Exclude<ConnectionState, "connected" | "absent">, string]>([
    ["pending", "CONNECTING"],
    ["needs_auth", "AUTH_REQUIRED"],
    ["failed", "CONNECTION_FAILED"],
    ["disabled", "DISABLED"],
  ])("maps %s to %s and leads with its next step", (state, code) => {
    const error = state === "failed" || state === "needs_auth" ? { error: "see https://auth.example/x" } : {}
    const status = buildStatus(inputs({ servers: [{ name: "granola", title: "Granola", status: { status: state, ...error } }], tools: [] }))
    expect(status.state).toBe(state)
    expect(status.problem?.code).toBe(code)
    expect(status.next).toBe(status.problem?.next)
    expect(status.title).toBeUndefined()
    expect(JSON.stringify(status)).not.toContain("auth.example")
  })

  it("reports an absent server as not configured", () => {
    const status = buildStatus(inputs({ servers: [{ name: "github", status: { status: "connected" } }] }))
    expect(status.state).toBe("absent")
    expect(status.problem?.code).toBe("NOT_REGISTERED")
  })

  it("counts unknown upstream tools and lists only names that pass the sanitizer", () => {
    const tools = [
      ...inputs().tools,
      { id: "granola_brand_new_tool" },
      { id: "granola_Weird-Name" },
      ...Array.from({ length: 25 }, (_, index) => ({ id: `granola_extra_${index}` })),
    ]
    const status = buildStatus(inputs({ tools }))
    expect(status.tools.unknown).toBe(27)
    expect(status.tools.unknownNames).toHaveLength(20)
    expect(status.tools.unknownNames[0]).toBe("brand_new_tool")
    expect(status.tools.unknownNames).not.toContain("Weird-Name")
    expect(formatStatus(status)).toContain("Tools: 3 available, 1 hidden, 27 unknown, asking before they run: brand_new_tool,")
  })

  it("names agents that missed the defaults and offers the block for each agent's own permissions", () => {
    const status = buildStatus(inputs({ agents: [guarded(), agent("reviewer")] }))
    expect(status.unguardedAgents).toEqual(["reviewer"])
    expect(status.permissionsBlock).toEqual(DEFAULT_RULES)
    expect(status.next).toBe(agentFix(["reviewer"]))
    expect(status.next).toBe("Put the Granola block first in that agent's own permissions (agents.reviewer.permissions), followed by your top-level rules for granola_ actions.")
    const text = formatStatus(status)
    expect(text).toContain("Agents without default rules: reviewer: Granola writes run there without asking")
    expect(text).toContain(`  "agents": {\n    "reviewer": {\n      "permissions": [\n        ${JSON.stringify(DEFAULT_RULES[0])},`)
    expect(text).not.toMatch(/^"permissions": \[/m)
  })

  it("lists every agent that missed the defaults in the fix", () => {
    const status = buildStatus(inputs({ agents: [agent("reviewer"), agent("mdagent")] }))
    expect(status.next).toContain("(agents.reviewer.permissions, agents.mdagent.permissions)")
    expect(formatStatus(status)).toContain('...the same for "mdagent"')
  })

  it("labels a config conflict, makes its removal the next step, and marks an untested host", () => {
    const status = buildStatus(inputs({
      conflict: "your OpenCode config defines mcp.servers.granola for a different server, so the plugin left it unchanged",
      host: { version: "2.3.0", tested: ">=2.2.3 <2.3.0", warning: "outside the tested line >=2.2.3 <2.3.0; it runs because allowUntestedHost is true" },
    }))
    expect(status.next).toBe(CONFLICT_NEXT)
    const text = formatStatus(status)
    expect(text).toContain("Connection: conflict: your OpenCode config defines mcp.servers.granola for a different server")
    expect(text).toContain("OpenCode: 2.3.0 (host untested: outside the tested line >=2.2.3 <2.3.0; it runs because allowUntestedHost is true)")
  })

  it("prints the rows in the shared order, with exactly one Next step line", () => {
    const text = formatStatus(buildStatus(inputs({ workspace: "Acme", agents: [agent("reviewer")] })))
    const labels = text.split("\n").filter((line) => /^[A-Z][A-Za-z ]+: /.test(line)).map((line) => line.slice(0, line.indexOf(":")))
    expect(text.split("\n")[0]).toBe("Granola status")
    expect(labels).toEqual(["Connection", "Account", "Access", "Export folder", "Tools", "Agents without default rules", "OpenCode", "Next step"])
    expect(text).toContain("Account: workspace Acme")
    expect(text).toContain(`OpenCode: 2.2.3 (tested), plugin ${VERSION}`)
    expect(text).not.toContain("`")
  })

  it("says the workspace is unknown until an account read, with nothing to do", () => {
    const status = buildStatus(inputs())
    expect(status.next).toBe("Nothing to do.")
    expect(formatStatus(status)).toContain("Account: workspace unknown until the agent reads your Granola account")
  })

  it("formats sign-in required with both paths and the code", () => {
    const text = formatStatus(buildStatus(inputs({ servers: [{ name: "granola", status: { status: "needs_auth", error: "x" } }], tools: [] })))
    expect(text).toContain("Connection: sign-in required: Granola needs you to sign in. (AUTH_REQUIRED)")
    expect(text.split("\n").filter((line) => line.startsWith("Next step:"))).toEqual(["Next step: Run /connect and choose Granola, or run opencode mcp auth granola in a terminal."])
  })

  it("only uses fields the output schema declares", () => {
    const properties = Object.keys(STATUS_SCHEMA.properties)
    const statuses = [
      buildStatus(inputs({ workspace: "Acme", conflict: "c", agents: [agent("reviewer")], host: { version: "2.3.0", tested: "x", warning: "w" } })),
      buildStatus(inputs({ servers: [] })),
    ]
    for (const status of statuses) {
      for (const key of Object.keys(status)) expect(properties).toContain(key)
      for (const key of STATUS_SCHEMA.required) expect(status).toHaveProperty(key)
    }
  })
})

describe("createStatus", () => {
  it("reads servers, tools and agents from OpenCode without calling Granola", async () => {
    const host = fakeHost({ baseTools: () => [{ id: "granola_get_meetings", name: "get_meetings" }] })
    host.rebuild()
    host.listed.servers = [{ name: "granola", status: { status: "connected" } }]
    host.listed.agents = [guarded()]
    const source = createStatus(host.ctx, () => ({
      hidden: 0, exportDirectory: "/x", pluginVersion: VERSION, host: { version: "2.2.3", tested: ">=2.2.3 <2.3.0" },
    }))
    const status = await source.read()
    expect(status.state).toBe("connected")
    expect(status.tools.visible).toBe(1)
  })
})
