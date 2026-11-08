import type { Plugin } from "@opencode/plugin"
import { PLUGIN_READS, READ_TOOLS, toolID } from "./known-tools.js"

export interface Rule {
  action: string
  resource: string
  effect: "allow" | "deny" | "ask"
}

/**
 * Inserted right after an agent's base `* * allow`: every Granola tool asks, the known reads and the plugin's own read
 * (events_list, which Memory's collector runs unattended) are allowed, and
 * give_feedback is denied. Granola's server instructions tell the model to send give_feedback on its own, which would
 * put an unexplained prompt in front of the user; a deny on `*` hides the tool instead. Rules are last-match-wins, so
 * the user's own rules and saved "Always allow" approvals, which come later, win.
 */
export const DEFAULT_RULES: readonly Readonly<Rule>[] = [
  { action: "granola_*", resource: "*", effect: "ask" },
  ...[...READ_TOOLS, ...PLUGIN_READS].map((name) => ({ action: toolID(name), resource: "*", effect: "allow" as const })),
  { action: toolID("give_feedback"), resource: "*", effect: "deny" },
]

const same = (left: Readonly<Rule> | undefined, right: Readonly<Rule>) =>
  left?.action === right.action && left.resource === right.resource && left.effect === right.effect

const isBaseAllow = (rule: Readonly<Rule>) => rule.action === "*" && rule.resource === "*" && rule.effect === "allow"

/** Whether the whole block appears, in order, anywhere from `from` on. */
function hasDefaultsFrom(rules: readonly Readonly<Rule>[], from: number): boolean {
  return rules.some((_, start) => start >= from && DEFAULT_RULES.every((rule, offset) => same(rules[start + offset], rule)))
}

/**
 * Whether the agent carries the defaults after its base allow. Other plugins insert their own blocks at the same
 * place, so the block may sit anywhere after it.
 */
export function hasDefaults(rules: readonly Readonly<Rule>[]): boolean {
  const base = rules.findIndex(isBaseAllow)
  return base >= 0 && hasDefaultsFrom(rules, base + 1)
}

/**
 * Inserts the defaults after the first base allow. Agents without one are left unchanged, so a stricter
 * agent is never weakened, and an agent that already has the block after its base allow is untouched on replay.
 */
export function insertDefaults(rules: Rule[]): boolean {
  const base = rules.findIndex(isBaseAllow)
  if (base < 0 || hasDefaultsFrom(rules, base + 1)) return false
  rules.splice(base + 1, 0, ...DEFAULT_RULES.map((rule) => ({ ...rule })))
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
 * Agents that need the per-agent fix: they have a base allow but missed the defaults (for example agents defined only
 * in the user's config, which OpenCode creates after plugins run), and their own rules would let a Granola tool this
 * plugin does not know run without asking. An agent whose rules already ask or deny for every Granola tool needs no
 * fix and is not listed.
 */
export function unguardedAgents(agents: readonly { readonly id: string; readonly permissions: readonly Readonly<Rule>[] }[]): string[] {
  return agents
    .filter((agent) => agent.permissions.some(isBaseAllow) && !hasDefaults(agent.permissions) && evaluate(agent.permissions, UNKNOWN_TOOL) === "allow")
    .map((agent) => agent.id)
}

export async function registerPermissions(ctx: { readonly agent: Pick<Plugin.Context["agent"], "transform"> }): Promise<void> {
  await ctx.agent.transform((editor) => {
    for (const agent of editor.list()) editor.update(agent.id, (current) => void insertDefaults(current.permissions))
  })
}
