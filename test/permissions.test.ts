import { describe, expect, it } from "vitest"
import { PLUGIN_READS, PLUGIN_TOOLS, READ_TOOLS, WRITE_TOOLS, toolID } from "../src/known-tools.js"
import { defaultRules, hasDefaults, insertDefaults, matches, registerPermissions, unguardedAgents, type Rule } from "../src/permissions.js"
import { agent, fakeHost } from "./fakes.js"

const base: Rule = { action: "*", resource: "*", effect: "allow" }

// Last match wins, as in OpenCode's permission evaluation; no match asks.
function effect(rules: readonly Rule[], action: string): Rule["effect"] {
  return rules.findLast((rule) => matches(action, rule.action) && matches("*", rule.resource))?.effect ?? "ask"
}

describe("default Granola rules", () => {
  it("allow every Granola tool by default, reads, the plugin's own read and one Granola adds later alike", () => {
    const rules = defaultRules()
    expect(rules[0]).toEqual({ action: "granola_*", resource: "*", effect: "allow" })
    expect(rules.slice(1)).toEqual(
      [...READ_TOOLS, ...PLUGIN_READS, ...WRITE_TOOLS, ...PLUGIN_TOOLS].map((name) => ({ action: `granola_${name}`, resource: "*", effect: "allow" })),
    )
    expect(rules.filter((rule) => rule.effect !== "allow")).toEqual([])
  })

  it("ask-changes allows the reads and asks for everything else, new tools included", () => {
    const rules: Rule[] = [base]
    insertDefaults(rules, "ask-changes")
    expect(effect(rules, "granola_*")).toBe("ask")
    for (const name of READ_TOOLS) expect(effect(rules, toolID(name)), name).toBe("allow")
    for (const name of [...WRITE_TOOLS, ...PLUGIN_TOOLS]) expect(effect(rules, toolID(name)), name).toBe("ask")
    expect(effect(rules, "granola_brand_new_tool")).toBe("ask")
  })

  it("read-only allows the reads and denies everything else, new tools included", () => {
    const rules: Rule[] = [base]
    insertDefaults(rules, "read-only")
    for (const name of READ_TOOLS) expect(effect(rules, toolID(name)), name).toBe("allow")
    for (const name of [...WRITE_TOOLS, ...PLUGIN_TOOLS]) expect(effect(rules, toolID(name)), name).toBe("deny")
    expect(effect(rules, "granola_brand_new_tool")).toBe("deny")
    // give_feedback is a send, and it follows the access value like every other change.
    expect(effect(rules, toolID("give_feedback"))).toBe("deny")
  })

  it("match the tools Granola's server lists: ten reads, seven writes and the plugin's export", () => {
    expect([...READ_TOOLS].sort()).toEqual([
      "get_account_info", "get_meeting_attachment", "get_meeting_transcript", "get_meetings", "list_meeting_folders",
      "list_meetings", "list_templates", "query_granola_meetings", "search_meetings", "search_transcripts",
    ])
    expect([...WRITE_TOOLS].sort()).toEqual([
      "add_note_to_folder", "create_folder", "generate_summary", "give_feedback", "remove_note_from_folder", "update_folder", "update_private_notes",
    ])
    expect([...PLUGIN_TOOLS]).toEqual(["export_markdown"])
  })

  it("are inserted right after the base allow and before every other rule", () => {
    const rules: Rule[] = [base, { action: "read", resource: "*.env", effect: "ask" }, { action: "question", resource: "*", effect: "allow" }]
    expect(insertDefaults(rules)).toBe(true)
    expect(rules[0]).toEqual(base)
    expect(rules.slice(1, 1 + defaultRules().length)).toEqual(defaultRules())
    expect(rules.slice(1 + defaultRules().length)).toEqual([
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

  it("are idempotent when the same agent is transformed again, for every access value", () => {
    for (const access of ["all", "ask-changes", "read-only"] as const) {
      const rules: Rule[] = [base]
      expect(insertDefaults(rules, access)).toBe(true)
      const once = structuredClone(rules)
      expect(insertDefaults(rules, access)).toBe(false)
      expect(rules).toEqual(once)
    }
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
    const rules: Rule[] = [...defaultRules().map((rule) => ({ ...rule })), base]
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

  it("run every tool at the default, and keep later rules in charge", () => {
    const rules: Rule[] = [base]
    insertDefaults(rules)
    for (const name of [...READ_TOOLS, ...WRITE_TOOLS, ...PLUGIN_TOOLS]) expect(effect(rules, toolID(name))).toBe("allow")
    expect(effect(rules, "granola_brand_new_tool")).toBe("allow")
    expect(effect(rules, "shell")).toBe("allow")

    // User rules are appended after the inserted block, so they win.
    const user = [...rules, { action: "granola_create_folder", resource: "*", effect: "deny" as const }, { action: "granola_get_meetings", resource: "*", effect: "ask" as const }]
    expect(effect(user, "granola_create_folder")).toBe("deny")
    expect(effect(user, "granola_get_meetings")).toBe("ask")
    expect(effect([...rules, { action: "granola_*", resource: "*", effect: "deny" }], "granola_list_meetings")).toBe("deny")
  })

  it("keep stricter agents strict: a later deny still wins", () => {
    const explore: Rule[] = [base, { action: "*", resource: "*", effect: "deny" }, { action: "read", resource: "*", effect: "allow" }]
    insertDefaults(explore)
    expect(effect(explore, "granola_get_meetings")).toBe("deny")
    expect(effect(explore, "granola_create_folder")).toBe("deny")

    const plan: Rule[] = [base, { action: "edit", resource: "*", effect: "deny" }]
    insertDefaults(plan, "read-only")
    expect(effect(plan, "edit")).toBe("deny")
    expect(effect(plan, "granola_update_folder")).toBe("deny")
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
      expect(rules.slice(1, 1 + defaultRules().length)).toEqual(defaultRules())
      expect(rules.filter((rule) => rule.action === "granola_*")).toHaveLength(1)
    }
    expect(host.agents.get("strict")!.permissions).toEqual([{ action: "*", resource: "*", effect: "deny" }])
  })

  it("inserts the block for a restricted access value", async () => {
    const host = fakeHost({ baseAgents: () => [agent("build")] })
    await registerPermissions(host.ctx, "ask-changes")
    host.rebuild()
    const rules = host.agents.get("build")!.permissions
    expect(rules.slice(1, 1 + defaultRules("ask-changes").length)).toEqual(defaultRules("ask-changes"))
    expect(rules.filter((rule) => rule.action === "granola_*")).toHaveLength(1)
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

  it("does not name an agent whose own rules already ask or deny for every Granola tool", () => {
    // Like the probe agents in the QA run: a base allow, then a closing ask for everything.
    const asking = agent("probe", { action: "*", resource: "*", effect: "ask" })
    // A write allowed by a broad rule of the user's own, while a new Granola tool still asks.
    const narrow = agent("folders", { action: "granola_*", resource: "*", effect: "ask" }, { action: "*_folder", resource: "*", effect: "allow" })
    expect(unguardedAgents([asking, narrow])).toEqual([])
  })

  it("names an agent with no block whose own rules allow every Granola tool, so the fix can add the block before them", () => {
    const trusting = agent("trusting", { action: "granola_*", resource: "*", effect: "allow" })
    expect(unguardedAgents([trusting])).toEqual(["trusting"])
  })

  it("never names an agent without a base allow, which gets no rules", () => {
    const strict = { id: "strict", permissions: [{ action: "g*", resource: "*", effect: "allow" as const }] }
    expect(unguardedAgents([strict])).toEqual([])
  })

  it("clears once the user's top-level block or a Granola deny covers the agent", () => {
    const fixed = agent("reviewer", ...defaultRules())
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

  it("counts the block for the access value it was generated from", () => {
    // The build agent carries the all block: guarded at "all", and named when the option asks for more than it gives.
    expect(unguardedAgents([withDefaults()], "all")).toEqual([])
    expect(unguardedAgents([withDefaults()], "read-only")).toEqual(["build"])
    // The read-only block denies a new tool, so no fix is needed whatever the option says.
    const careful = agent("careful", ...defaultRules("read-only"))
    for (const access of ["all", "ask-changes", "read-only"] as const) expect(unguardedAgents([careful], access)).toEqual([])
  })
})
