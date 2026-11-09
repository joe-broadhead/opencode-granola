import type { Plugin } from "@opencode/plugin"
import { WRITE_TOOLS, PLUGIN_TOOLS, READ_TOOLS, toolID } from "./known-tools.js"
import type { Access } from "./options.js"

export interface Rule {
  action: string
  resource: string
  effect: "allow" | "deny" | "ask"
}

/**
 * The rules inserted right after an agent's base `* * allow`. Broad first, narrow last, because the last matching rule
 * wins: every tool the plugin registers is allowed at `access: "all"`, and so is one Granola adds later; `ask-changes`
 * asks for anything that is not a read, and `read-only` denies it. The reads are always allowed, which is why the first
 * rule alone decides a tool the plugin does not know yet. The user's own rules, which come later, still win.
 */
export function defaultRules(access: Access = "all"): Rule[] {
  const other: Rule["effect"] = access === "all" ? "allow" : access === "ask-changes" ? "ask" : "deny"
  return [
    { action: "granola_*", resource: "*", effect: other },
    ...READ_TOOLS.map((name) => ({ action: toolID(name), resource: "*", effect: "allow" as const })),
    ...[...WRITE_TOOLS, ...PLUGIN_TOOLS].map((name) => ({ action: toolID(name), resource: "*", effect: other })),
  ]
}

const same = (left: Readonly<Rule> | undefined, right: Readonly<Rule>) =>
  left?.action === right.action && left.resource === right.resource && left.effect === right.effect

const isBaseAllow = (rule: Readonly<Rule>) => rule.action === "*" && rule.resource === "*" && rule.effect === "allow"

/** Whether the whole block appears, in order, anywhere from `from` on. */
function hasDefaultsFrom(rules: readonly Readonly<Rule>[], from: number, block: readonly Readonly<Rule>[]): boolean {
  return rules.some((_, start) => start >= from && block.every((rule, offset) => same(rules[start + offset], rule)))
}

/**
 * Whether the agent carries the defaults for this `access` after its base allow. Other plugins insert their own blocks
 * at the same place, so the block may sit anywhere after it.
 */
export function hasDefaults(rules: readonly Readonly<Rule>[], access: Access = "all"): boolean {
  const base = rules.findIndex(isBaseAllow)
  return base >= 0 && hasDefaultsFrom(rules, base + 1, defaultRules(access))
}

/**
 * Inserts the defaults after the first base allow. Agents without one are left unchanged, so a stricter
 * agent is never weakened, and an agent that already has the block after its base allow is untouched on replay.
 */
export function insertDefaults(rules: Rule[], access: Access = "all"): boolean {
  const block = defaultRules(access)
  const base = rules.findIndex(isBaseAllow)
  if (base < 0 || hasDefaultsFrom(rules, base + 1, block)) return false
  rules.splice(base + 1, 0, ...block.map((rule) => ({ ...rule })))
  return true
}

/** OpenCode's wildcard: `*` matches any run of characters and `?` one character. */
export function matches(input: string, pattern: string): boolean {
  const source = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")
  return new RegExp(`^${source}$`, "s").test(input)
}

/** The effect of `rules` for a Granola tool call (resource `*`): the last matching rule wins, and no match asks. */
function evaluate(rules: readonly Readonly<Rule>[], action: string): Rule["effect"] {
  return rules.findLast((rule) => matches(action, rule.action) && matches("*", rule.resource))?.effect ?? "ask"
}

/** Stands in for a Granola tool this plugin version does not know yet. */
const UNKNOWN_TOOL = toolID("unknown_tool")

/**
 * Agents that need the per-agent fix: they have a base allow but missed the block for this `access` (for example agents
 * defined only in the user's config, which OpenCode creates after plugins run), and their own rules would let a Granola
 * tool this plugin does not know run without asking. An agent whose rules already ask or deny for every Granola tool
 * needs no fix and is not listed.
 */
export function unguardedAgents(
  agents: readonly { readonly id: string; readonly permissions: readonly Readonly<Rule>[] }[],
  access: Access = "all",
): string[] {
  return agents
    .filter((agent) => agent.permissions.some(isBaseAllow) && !hasDefaults(agent.permissions, access) && evaluate(agent.permissions, UNKNOWN_TOOL) === "allow")
    .map((agent) => agent.id)
}

export async function registerPermissions(
  ctx: { readonly agent: Pick<Plugin.Context["agent"], "transform"> },
  access: Access = "all",
): Promise<void> {
  await ctx.agent.transform((editor) => {
    for (const agent of editor.list()) editor.update(agent.id, (current) => void insertDefaults(current.permissions, access))
  })
}
