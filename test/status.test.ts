import { describe, expect, it } from "vitest"
import { connectionProblem } from "../src/errors.js"
import { DEFAULT_RULES, insertDefaults } from "../src/permissions.js"
import { readPackageInfo } from "../src/meta.js"
import { STATUS_SCHEMA, type ConnectionState } from "../src/rpc/contract.js"
import { AGENT_FIX, CONFLICT_NEXT, UNTESTED_HOST_NEXT, buildStatus, createStatus, formatStatus, type StatusInputs } from "../src/status.js"
import { agent, fakeHost } from "./fakes.js"

const VERSION = readPackageInfo().version
const RANGE = ">=2.2.3 <2.3.0"

const BUNDLED = [
  { name: "granola", path: "/plugin/skills/granola/SKILL.md" },
  { name: "granola-meeting-brief", path: "/plugin/skills/granola-meeting-brief/SKILL.md" },
]
const USER_SKILL = "/home/someone/.config/opencode/skills/granola/SKILL.md"

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
    version: VERSION,
    host: { version: "2.2.3", range: RANGE, tested: true },
    bundledSkills: BUNDLED,
    skills: BUNDLED.map((skill) => ({ id: skill.name, path: skill.path })),
    ...overrides,
  }
}

describe("status model", () => {
  it("reports a connected server with the shared fields, tool counts and the next step", () => {
    const status = buildStatus(inputs({ workspace: "Acme" }))
    expect(status).toEqual({
      version: VERSION,
      host: { version: "2.2.3", range: RANGE, tested: true },
      state: "connected",
      title: "Granola",
      tools: { visible: 3, hidden: 1, unknown: 0, unknownNames: [] },
      workspace: "Acme",
      unguardedAgents: [],
      shadowedSkills: [],
      exportDirectory: "/home/someone/Granola",
      nextStep: "Nothing to do.",
    })
  })

  it.each<[Exclude<ConnectionState, "connected" | "absent">, string, string]>([
    ["pending", "connecting", "CONNECTING"],
    ["needs_auth", "sign_in_required", "AUTH_REQUIRED"],
    ["failed", "failed", "CONNECTION_FAILED"],
    ["disabled", "disabled", "DISABLED"],
  ])("maps %s to the shared state %s and the code %s, and leads with its next step", (connection, state, code) => {
    const error = connection === "failed" || connection === "needs_auth" ? { error: "see https://auth.example/x" } : {}
    const status = buildStatus(inputs({ servers: [{ name: "granola", title: "Granola", status: { status: connection, ...error } }], tools: [] }))
    expect(status.state).toBe(state)
    expect(status.problem).toEqual({ code, message: connectionProblem(connection, error.error)!.message })
    expect(status.nextStep).toBe(connectionProblem(connection)!.next)
    expect(status.title).toBeUndefined()
    expect(JSON.stringify(status)).not.toContain("auth.example")
  })

  it("reports an absent server as not_configured", () => {
    const status = buildStatus(inputs({ servers: [{ name: "github", status: { status: "connected" } }] }))
    expect(status.state).toBe("not_configured")
    expect(status.problem?.code).toBe("NOT_REGISTERED")
    expect(formatStatus(status)).toContain("Connection: not configured: ")
  })

  it("reports the user's own granola server for another URL as the state conflict, whatever its connection", () => {
    const conflict = "your OpenCode config defines mcp.servers.granola for a different server, so the plugin left it unchanged"
    const status = buildStatus(inputs({ conflict, servers: [{ name: "granola", status: { status: "disabled" } }] }))
    expect(status).toMatchObject({ state: "conflict", conflict, nextStep: CONFLICT_NEXT })
    expect(status.problem).toBeUndefined()
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
    // Available counts every Granola tool the model can call, unknown ones included, but not the plugin's export.
    expect(status.tools.visible).toBe(30)
    expect(formatStatus(status)).toContain("Tools: 30 available, 1 hidden, 27 unknown, asking before they run: brand_new_tool,")
  })

  it("names agents that missed the defaults and offers the block for each agent's own permissions", () => {
    const status = buildStatus(inputs({ agents: [guarded(), agent("reviewer")] }))
    expect(status.unguardedAgents).toEqual(["reviewer"])
    expect(status.permissionsBlock).toEqual(DEFAULT_RULES)
    expect(status.nextStep).toBe(AGENT_FIX)
    expect(status.nextStep).toBe("Put the default rules shown by /granola-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for Granola tools.")
    const text = formatStatus(status)
    expect(text).toContain("Agents without default rules: reviewer\n")
    expect(text).toContain(`  "agents": {\n    "reviewer": {\n      "permissions": [\n        ${JSON.stringify(DEFAULT_RULES[0])},`)
    expect(text).not.toMatch(/^"permissions": \[/m)
  })

  it("names a skill that takes the place of the plugin's own, shows it, and says to rename or move it", () => {
    const skills = [{ id: "granola", path: USER_SKILL }, { id: "granola-meeting-brief", path: BUNDLED[1]!.path }, { id: "other", path: "/x/SKILL.md" }]
    const status = buildStatus(inputs({ skills }))
    expect(status.shadowedSkills).toEqual([{ name: "granola", path: USER_SKILL }])
    expect(status.nextStep).toBe(`Rename or move the skill at ${USER_SKILL}, which uses the id of the plugin's granola skill, so OpenCode loads it instead of the plugin's own.`)
    expect(formatStatus(status)).toContain(`Skills: granola is replaced by ${USER_SKILL}\n`)
    // The agent fix comes first: it keeps writes from running without asking.
    expect(buildStatus(inputs({ skills, agents: [agent("reviewer")] })).nextStep).toBe(AGENT_FIX)
  })

  it("names every shadowed skill in one next step", () => {
    const other = "/project/.opencode/skills/granola-meeting-brief/SKILL.md"
    const status = buildStatus(inputs({ skills: [{ id: "granola", path: USER_SKILL }, { id: "granola-meeting-brief", path: other }] }))
    expect(status.shadowedSkills.map((skill) => skill.name)).toEqual(["granola", "granola-meeting-brief"])
    expect(status.nextStep).toBe(`Rename or move the skills at ${USER_SKILL} and ${other}, which use the ids of the plugin's granola and granola-meeting-brief skills, so OpenCode loads them instead of the plugin's own.`)
  })

  it("shows the plugin's own skills when nothing takes their place", () => {
    expect(formatStatus(buildStatus(inputs()))).toContain("Skills: the plugin's own\n")
  })

  it("lists every agent that missed the defaults in the fix", () => {
    const status = buildStatus(inputs({ agents: [agent("reviewer"), agent("mdagent")] }))
    expect(status.unguardedAgents).toEqual(["reviewer", "mdagent"])
    expect(status.nextStep).toBe(AGENT_FIX)
    expect(formatStatus(status)).toContain("Agents without default rules: reviewer, mdagent\n")
    expect(formatStatus(status)).toContain('...the same for "mdagent"')
  })

  it("labels a config conflict, makes its removal the next step, and marks a host outside the range", () => {
    const status = buildStatus(inputs({
      conflict: "your OpenCode config defines mcp.servers.granola for a different server, so the plugin left it unchanged",
      host: { version: "2.3.0", range: RANGE, tested: false, warning: "outside the supported range >=2.2.3 <2.3.0; it runs because allowUntestedHost is true" },
    }))
    expect(status.nextStep).toBe(CONFLICT_NEXT)
    expect(status.host).toEqual({ version: "2.3.0", range: RANGE, tested: false })
    const text = formatStatus(status)
    expect(text).toContain("Connection: conflict: your OpenCode config defines mcp.servers.granola for a different server")
    expect(text).toContain(`OpenCode: 2.3.0 (host untested: outside the supported range >=2.2.3 <2.3.0; it runs because allowUntestedHost is true), plugin ${VERSION}`)
  })

  it("calls a tested release tested, and another release in the range untested without changing the state or next step", () => {
    expect(formatStatus(buildStatus(inputs({ host: { version: "2.2.5", range: RANGE, tested: true } })))).toContain(`OpenCode: 2.2.5 (tested; supported range ${RANGE}), plugin ${VERSION}`)
    const untested = buildStatus(inputs({ host: { version: "2.2.6", range: RANGE, tested: false } }))
    expect(untested).toMatchObject({ state: "connected", host: { version: "2.2.6", range: RANGE, tested: false }, nextStep: "Nothing to do." })
    expect(formatStatus(untested)).toContain(`OpenCode: 2.2.6 (untested; supported range ${RANGE}), plugin ${VERSION}`)
  })

  it("gives a host outside the range, running because of allowUntestedHost, its own next step when nothing else is needed", () => {
    const host = { version: "2.3.0", range: RANGE, tested: false, warning: "outside the supported range >=2.2.3 <2.3.0; it runs because allowUntestedHost is true" }
    expect(buildStatus(inputs({ host })).nextStep).toBe(UNTESTED_HOST_NEXT)
    expect(UNTESTED_HOST_NEXT).toBe("If Granola misbehaves, use OpenCode 2.2.3, 2.2.4 or 2.2.5.")
    // Anything else to do comes first.
    expect(buildStatus(inputs({ host, agents: [agent("reviewer")] })).nextStep).toBe(AGENT_FIX)
  })

  it("gives host.version null when OpenCode reports no version", () => {
    const status = buildStatus(inputs({ host: { version: "", range: RANGE, tested: false, warning: "w" } }))
    expect(status.host.version).toBeNull()
    expect(formatStatus(status)).toContain("OpenCode: unknown (host untested: w)")
  })

  it("prints the rows in the shared order, with exactly one Next step line", () => {
    const text = formatStatus(buildStatus(inputs({ workspace: "Acme", agents: [agent("reviewer")] })))
    const labels = text.split("\n").filter((line) => /^[A-Z][A-Za-z ]+: /.test(line)).map((line) => line.slice(0, line.indexOf(":")))
    expect(text.split("\n")[0]).toBe("Granola status")
    expect(labels).toEqual(["Connection", "Account", "Access", "Export folder", "Skills", "Tools", "Agents without default rules", "OpenCode", "Next step"])
    expect(text).toContain("Account: workspace Acme")
    expect(text).toContain(`OpenCode: 2.2.3 (tested; supported range ${RANGE}), plugin ${VERSION}`)
    expect(text).not.toContain("`")
  })

  it("always prints the agents row, with none when every agent has the defaults", () => {
    const text = formatStatus(buildStatus(inputs({ servers: [], tools: [] })))
    const labels = text.split("\n").filter((line) => /^[A-Z][A-Za-z ]+: /.test(line)).map((line) => line.slice(0, line.indexOf(":")))
    expect(labels).toEqual(["Connection", "Account", "Access", "Export folder", "Skills", "Tools", "Agents without default rules", "OpenCode", "Next step"])
    expect(text).toContain("\nAgents without default rules: none\n")
  })

  it("says the workspace is unknown until an account read, with nothing to do", () => {
    const status = buildStatus(inputs())
    expect(status.nextStep).toBe("Nothing to do.")
    expect(formatStatus(status)).toContain("Account: workspace unknown until the agent reads your Granola account")
  })

  it("formats sign-in required with both paths and the code", () => {
    const text = formatStatus(buildStatus(inputs({ servers: [{ name: "granola", status: { status: "needs_auth", error: "x" } }], tools: [] })))
    expect(text).toContain("Connection: sign-in required: Granola needs you to sign in. (AUTH_REQUIRED)")
    expect(text.split("\n").filter((line) => line.startsWith("Next step:"))).toEqual(["Next step: Run /connect and choose Granola, then press o or Enter to open the sign-in page (in a terminal, opencode mcp auth granola opens it automatically)."])
  })

  it("only uses fields the output schema declares", () => {
    const properties = Object.keys(STATUS_SCHEMA.properties)
    const statuses = [
      buildStatus(inputs({ workspace: "Acme", conflict: "c", agents: [agent("reviewer")], host: { version: "2.3.0", range: RANGE, tested: false, warning: "w" } })),
      buildStatus(inputs({ servers: [] })),
    ]
    for (const status of statuses) {
      for (const key of Object.keys(status)) expect(properties).toContain(key)
      for (const key of STATUS_SCHEMA.required) expect(status).toHaveProperty(key)
      expect(STATUS_SCHEMA.properties.state.enum).toContain(status.state)
    }
  })
})

describe("createStatus", () => {
  const fixed = () => ({ hidden: 0, exportDirectory: "/x", version: VERSION, host: { version: "2.2.3", range: RANGE, tested: true }, bundledSkills: BUNDLED })

  it("reads servers, tools, agents and skills from OpenCode without calling Granola", async () => {
    const host = fakeHost({ baseTools: () => [{ id: "granola_get_meetings", name: "get_meetings" }] })
    host.rebuild()
    host.listed.servers = [{ name: "granola", status: { status: "connected" } }]
    host.listed.agents = [guarded()]
    host.listed.skills = [{ id: "granola", path: USER_SKILL }]
    const status = await createStatus(host.ctx, fixed).read()
    expect(status.state).toBe("connected")
    expect(status.tools.visible).toBe(1)
    expect(status.shadowedSkills).toEqual([{ name: "granola", path: USER_SKILL }])
  })

  it("still reads status when OpenCode cannot list skills", async () => {
    const host = fakeHost()
    host.listed.servers = [{ name: "granola", status: { status: "connected" } }]
    host.ctx.skill.list = async () => { throw new Error("no skills") }
    const status = await createStatus(host.ctx, fixed).read()
    expect(status.state).toBe("connected")
    expect(status.shadowedSkills).toEqual([])
  })
})
