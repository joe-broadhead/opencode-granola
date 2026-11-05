import { describe, expect, it } from "vitest"
import { READ_TOOLS, WRITE_TOOLS, toolID } from "../src/known-tools.js"
import { DEFAULT_RULES, hasDefaults, insertDefaults, matches, registerPermissions, unguardedAgents, type Rule } from "../src/permissions.js"
import { agent, fakeHost } from "./fakes.js"

const base: Rule = { action: "*", resource: "*", effect: "allow" }

// Last match wins, as in OpenCode's permission evaluation; no match asks.
function effect(rules: readonly Rule[], action: string): Rule["effect"] {
  return rules.findLast((rule) => matches(action, rule.action) && matches("*", rule.resource))?.effect ?? "ask"
}

describe("default Granola rules", () => {
  it("ask for every Granola tool, allow exactly the known reads, then deny give_feedback", () => {
    expect(DEFAULT_RULES[0]).toEqual({ action: "granola_*", resource: "*", effect: "ask" })
    expect(DEFAULT_RULES.slice(1, -1)).toEqual(READ_TOOLS.map((name) => ({ action: `granola_${name}`, resource: "*", effect: "allow" })))
    expect(DEFAULT_RULES.at(-1)).toEqual({ action: "granola_give_feedback", resource: "*", effect: "deny" })
  })

  it("hide give_feedback, which Granola's own instructions tell the model to send unasked, and ask for every other write", () => {
    const rules: Rule[] = [base]
    insertDefaults(rules)
    expect(effect(rules, toolID("give_feedback"))).toBe("deny")
    for (const name of WRITE_TOOLS.filter((tool) => tool !== "give_feedback")) expect(effect(rules, toolID(name)), name).toBe("ask")
    // One rule of the user's, later, turns it back on.
    expect(effect([...rules, { action: "granola_give_feedback", resource: "*", effect: "ask" }], toolID("give_feedback"))).toBe("ask")
  })

  it("match the tools Granola's server lists: ten reads and seven writes", () => {
    expect([...READ_TOOLS].sort()).toEqual([
      "get_account_info", "get_meeting_attachment", "get_meeting_transcript", "get_meetings", "list_meeting_folders",
      "list_meetings", "list_templates", "query_granola_meetings", "search_meetings", "search_transcripts",
    ])
    expect([...WRITE_TOOLS].sort()).toEqual([
      "add_note_to_folder", "create_folder", "generate_summary", "give_feedback", "remove_note_from_folder", "update_folder", "update_private_notes",
    ])
  })

  it("are inserted right after the base allow and before every other rule", () => {
    const rules: Rule[] = [base, { action: "read", resource: "*.env", effect: "ask" }, { action: "question", resource: "*", effect: "allow" }]
    expect(insertDefaults(rules)).toBe(true)
    expect(rules[0]).toEqual(base)
    expect(rules.slice(1, 1 + DEFAULT_RULES.length)).toEqual(DEFAULT_RULES)
    expect(rules.slice(1 + DEFAULT_RULES.length)).toEqual([
      { action: "read", resource: "*.env", effect: "ask" },
      { action: "question", resource: "*", effect: "allow" },
    ])
    expect(hasDefaults(rules)).toBe(true)
  })

  it("leave agents without a base allow unchanged", () => {
    const strict: Rule[] = [{ action: "*", resource: "*", effect: "deny" }, { action: "read", resource: "*", effect: "allow" }]
    const before = structuredClone(strict)
    expect(insertDefaults(strict)).toBe(false)
    expect(strict).toEqual(before)
  })

  it("are idempotent when the same agent is transformed again", () => {
    const rules: Rule[] = [base]
    insertDefaults(rules)
    const once = structuredClone(rules)
    expect(insertDefaults(rules)).toBe(false)
    expect(rules).toEqual(once)
  })

  it("count as present when another plugin inserted its block at the same index afterwards", () => {
    const rules: Rule[] = [base, { action: "read", resource: "*.env", effect: "ask" }]
    insertDefaults(rules)
    // Another plugin's transform runs later and inserts directly after the base allow too.
    const other: Rule[] = [{ action: "linear_*", resource: "*", effect: "ask" }, { action: "linear_get_issue", resource: "*", effect: "allow" }]
    rules.splice(1, 0, ...other)
    expect(rules[1]).toEqual(other[0])
    expect(hasDefaults(rules)).toBe(true)
    const once = structuredClone(rules)
    expect(insertDefaults(rules)).toBe(false)
    expect(rules).toEqual(once)
    expect(unguardedAgents([{ id: "build", permissions: rules }])).toEqual([])
  })

  it("do not count a block that sits before the base allow", () => {
    const rules: Rule[] = [...DEFAULT_RULES.map((rule) => ({ ...rule })), base]
    expect(hasDefaults(rules)).toBe(false)
  })

  it("never change or reorder non-Granola rules", () => {
    const others: Rule[] = [
      { action: "edit", resource: "*", effect: "deny" },
      { action: "shell", resource: "git *", effect: "allow" },
      { action: "*", resource: "*", effect: "deny" },
    ]
    const rules: Rule[] = [base, ...structuredClone(others)]
    insertDefaults(rules)
    expect(rules.filter((rule) => !rule.action.startsWith("granola"))).toEqual([base, ...others])
  })

  it("make reads silent, writes and unknown tools ask, and keep later rules in charge", () => {
    const rules: Rule[] = [base]
    insertDefaults(rules)
    for (const name of READ_TOOLS) expect(effect(rules, toolID(name))).toBe("allow")
    for (const name of WRITE_TOOLS) expect(effect(rules, toolID(name))).toBe(name === "give_feedback" ? "deny" : "ask")
    expect(effect(rules, "granola_brand_new_tool")).toBe("ask")
    expect(effect(rules, "granola_export_markdown")).toBe("ask")
    expect(effect(rules, "shell")).toBe("allow")

    // User rules are appended after the inserted block, so they win.
    const user = [...rules, { action: "granola_create_folder", resource: "*", effect: "allow" as const }, { action: "granola_get_meetings", resource: "*", effect: "deny" as const }]
    expect(effect(user, "granola_create_folder")).toBe("allow")
    expect(effect(user, "granola_get_meetings")).toBe("deny")
    expect(effect([...rules, { action: "granola_*", resource: "*", effect: "deny" }], "granola_list_meetings")).toBe("deny")
  })

  it("keep stricter agents strict: a later deny still wins", () => {
    const explore: Rule[] = [base, { action: "*", resource: "*", effect: "deny" }, { action: "read", resource: "*", effect: "allow" }]
    insertDefaults(explore)
    expect(effect(explore, "granola_get_meetings")).toBe("deny")
    expect(effect(explore, "granola_create_folder")).toBe("deny")

    const plan: Rule[] = [base, { action: "edit", resource: "*", effect: "deny" }]
    insertDefaults(plan)
    expect(effect(plan, "edit")).toBe("deny")
    expect(effect(plan, "granola_update_folder")).toBe("ask")
  })
})

describe("registerPermissions", () => {
  it("inserts the block once into every agent with a base allow, across rebuilds", async () => {
    const host = fakeHost({
      baseAgents: () => [agent("build"), agent("plan", { action: "edit", resource: "*", effect: "deny" }), { id: "strict", permissions: [{ action: "*", resource: "*", effect: "deny" }] }],
    })
    await registerPermissions(host.ctx)
    host.rebuild()
    host.rebuild()
    for (const id of ["build", "plan"]) {
      const rules = host.agents.get(id)!.permissions
      expect(rules.slice(1, 1 + DEFAULT_RULES.length)).toEqual(DEFAULT_RULES)
      expect(rules.filter((rule) => rule.action === "granola_*")).toHaveLength(1)
    }
    expect(host.agents.get("strict")!.permissions).toEqual([{ action: "*", resource: "*", effect: "deny" }])
  })
})

describe("unguardedAgents", () => {
  const withDefaults = () => {
    const built = agent("build")
    insertDefaults(built.permissions)
    return built
  }

  it("names agents that missed the defaults and would run Granola writes without asking", () => {
    expect(unguardedAgents([withDefaults(), agent("reviewer"), agent("mdagent")])).toEqual(["reviewer", "mdagent"])
  })

  it("does not name an agent whose own rules already ask for every Granola tool", () => {
    // Like the perf-probe agents in the QA run: a base allow, then a closing ask for everything.
    const asking = agent("probe", { action: "*", resource: "*", effect: "ask" })
    // A write allowed by a broad rule of the user's own, while a new Granola tool still asks.
    const narrow = agent("folders", { action: "granola_*", resource: "*", effect: "ask" }, { action: "*_folder", resource: "*", effect: "allow" })
    expect(unguardedAgents([asking, narrow])).toEqual([])
  })

  it("names an agent with no block whose own rules allow every Granola tool, so the fix can add the block before them", () => {
    const allowed = agent("trusting", { action: "granola_*", resource: "*", effect: "allow" })
    expect(unguardedAgents([allowed])).toEqual(["trusting"])
  })

  it("never names an agent without a base allow, which gets no rules", () => {
    const strict = { id: "strict", permissions: [{ action: "g*", resource: "*", effect: "allow" as const }] }
    expect(unguardedAgents([strict])).toEqual([])
  })

  it("clears once the user's top-level block or a Granola deny covers the agent", () => {
    const fixed = agent("reviewer", ...DEFAULT_RULES)
    const denied = agent("locked", { action: "granola_*", resource: "*", effect: "deny" })
    const strict = { id: "strict", permissions: [{ action: "*", resource: "*", effect: "deny" as const }] }
    expect(unguardedAgents([fixed, denied, strict])).toEqual([])
  })

  it("still names an agent when one write is explicitly allowed but others fall through to allow-all", () => {
    const partly = agent("reviewer", { action: "granola_create_folder", resource: "*", effect: "allow" })
    expect(unguardedAgents([partly])).toEqual(["reviewer"])
  })

  it("does not flag built-in agents whose later user rules allow everything on purpose", () => {
    const built = withDefaults()
    built.permissions.push({ action: "*", resource: "*", effect: "allow" })
    expect(unguardedAgents([built])).toEqual([])
  })
})
