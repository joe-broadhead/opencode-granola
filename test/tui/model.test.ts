import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import type { Status } from "../../src/rpc/contract.js"
import { view, type Details } from "../../src/tui/model.js"

const VERSION = (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version
const SIGN_IN = "Run /connect and choose Granola, then press o or Enter to open the sign-in page (in a terminal, opencode mcp auth granola opens it automatically)."
const BLOCK = [
  { action: "granola_*", resource: "*", effect: "ask" as const },
  { action: "granola_get_meetings", resource: "*", effect: "allow" as const },
]

function status(overrides: Partial<Status> = {}): Status {
  return {
    state: "connected",
    title: "Granola",
    tools: { visible: 17, hidden: 1, unknown: 0, unknownNames: [] },
    unguardedAgents: [],
    exportDirectory: "/home/someone/Granola",
    version: VERSION,
    host: { version: "2.2.3", range: ">=2.2.3 <2.3.0", tested: true },
    nextStep: "Nothing to do.",
    ...overrides,
  }
}

const ready = (overrides: Partial<Status> = {}): Details => ({ type: "ready", status: status(overrides) })
const needsAuth = (overrides: Partial<Status> = {}): Details => ready({
  state: "sign_in_required",
  title: undefined,
  tools: { visible: 0, hidden: 0, unknown: 0, unknownNames: [] },
  problem: { code: "AUTH_REQUIRED", message: "Granola needs you to sign in." },
  nextStep: SIGN_IN,
  ...overrides,
})
const labels = (details: Details) => view(details).rows.map((row) => row.label)
const row = (details: Details, label: string) => view(details).rows.find((entry) => entry.label === label)

describe("status dialog view", () => {
  it("loading and unavailable: a Connection row and one next step", () => {
    expect(view({ type: "loading" })).toEqual({ rows: [{ label: "Connection", text: "checking", tone: "info" }], next: "Wait a moment." })
    expect(view({ type: "unavailable", reason: "the status request failed" })).toEqual({
      rows: [{ label: "Connection", text: "unknown: the status request failed", tone: "warning" }],
      next: "Check that granola.meetings is active in /plugins, then press r to refresh.",
    })
  })

  it("uses the shared row labels in the shared order", () => {
    expect(labels(ready())).toEqual(["Connection", "Account", "Access", "Export folder", "Tools", "Agents without default rules", "OpenCode"])
    expect(row(ready(), "Agents without default rules")).toEqual({ label: "Agents without default rules", text: "none" })
    expect(labels(ready({ unguardedAgents: ["reviewer"], permissionsBlock: BLOCK }))).toEqual(["Connection", "Account", "Access", "Export folder", "Tools", "Agents without default rules", "OpenCode"])
  })

  it("connected: the server, workspace, tool counts, host and Nothing to do", () => {
    const details = ready({ workspace: "Acme", tools: { visible: 17, hidden: 1, unknown: 2, unknownNames: ["brand_new_tool"] } })
    expect(row(details, "Connection")).toEqual({ label: "Connection", text: "connected (Granola)", tone: "ok" })
    expect(row(details, "Account")!.text).toBe("workspace Acme")
    expect(row(details, "Tools")!.text).toBe("17 available, 1 hidden, 2 unknown, asking before they run: brand_new_tool")
    expect(row(details, "OpenCode")!.text).toBe(`2.2.3 (tested; supported range >=2.2.3 <2.3.0), plugin ${VERSION}`)
    expect(view(details).next).toBe("Nothing to do.")
  })

  it("sign-in required: the label, the problem and its code", () => {
    expect(row(needsAuth(), "Connection")).toEqual({ label: "Connection", text: "sign-in required: Granola needs you to sign in. (AUTH_REQUIRED)", tone: "warning" })
    expect(row(needsAuth(), "Tools")!.text).toBe("none until Granola connects")
    expect(view(needsAuth()).next).toBe(SIGN_IN)
  })

  it("names agents without the default rules and gives the config to paste", () => {
    const agents = row(needsAuth({ unguardedAgents: ["reviewer", "mdagent"], permissionsBlock: BLOCK }), "Agents without default rules")!
    expect(agents.text).toBe("reviewer, mdagent: Granola changes and new tools may run there without asking")
    expect(agents.block).toEqual([
      `"agents": {`,
      `  "reviewer": {`,
      `    "permissions": [`,
      `      {"action":"granola_*","resource":"*","effect":"ask"},`,
      `      {"action":"granola_get_meetings","resource":"*","effect":"allow"},`,
      `      ...then your top-level rules for granola_ actions, then the agent's other rules`,
      `    ]`,
      `  },`,
      `  ...the same for "mdagent"`,
      `}`,
    ])
  })

  it("labels a conflict and an untested host", () => {
    const details = ready({
      state: "conflict",
      title: undefined,
      conflict: "your OpenCode config defines mcp.servers.granola for a different server",
      host: { version: "2.3.0", range: ">=2.2.3 <2.3.0", tested: false },
      hostWarning: "outside the supported range",
    })
    expect(row(details, "Connection")).toEqual({ label: "Connection", text: "conflict: your OpenCode config defines mcp.servers.granola for a different server", tone: "warning" })
    expect(row(details, "OpenCode")).toEqual({ label: "OpenCode", text: `2.3.0 (host untested: outside the supported range), plugin ${VERSION}`, tone: "warning" })
    const untested = ready({ host: { version: "2.2.6", range: ">=2.2.3 <2.3.0", tested: false } })
    expect(row(untested, "OpenCode")).toEqual({ label: "OpenCode", text: `2.2.6 (untested; supported range >=2.2.3 <2.3.0), plugin ${VERSION}`, tone: "info" })
  })

  it("says when the status method itself could not read the status", () => {
    expect(view({ type: "unavailable", reason: "Granola status could not be read (STATUS_UNAVAILABLE)", next: "Press r to refresh in a few seconds." }).next).toBe("Press r to refresh in a few seconds.")
  })
})
