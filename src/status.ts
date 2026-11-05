import type { Plugin } from "@opencode/plugin"
import { connectionProblem, type ConnectionState } from "./errors.js"
import type { HostCheck } from "./host-check.js"
import { SERVER, classify } from "./known-tools.js"
import { DEFAULT_RULES, unguardedAgents, type Rule } from "./permissions.js"
import { STATE_OF, statusRows, type ShadowedSkill, type Status } from "./rpc/contract.js"
import { TESTED_HOSTS } from "./hosts.js"

// The status model's wire shape lives in the RPC contract, so clients load it without the server code.
export { STATUS_SCHEMA, type Status } from "./rpc/contract.js"

export interface StatusInputs {
  readonly servers: readonly { readonly name: string; readonly title?: string; readonly status: { readonly status: Exclude<ConnectionState, "absent">; readonly error?: string } }[]
  readonly tools: readonly { readonly id: string }[]
  readonly agents: readonly { readonly id: string; readonly permissions: readonly Readonly<Rule>[] }[]
  /** The skills OpenCode lists now. */
  readonly skills: readonly { readonly id: string; readonly path: string }[]
  /** The plugin's own skills, with the files it registered. */
  readonly bundledSkills: readonly { readonly name: string; readonly path: string }[]
  readonly hidden: number
  readonly conflict?: string
  readonly workspace?: string
  readonly exportDirectory: string
  readonly version: string
  readonly host: HostCheck
}

const LISTED_UNKNOWN = 20
const SAFE_NAME = /^[a-z][a-z0-9_]{0,63}$/

/** The next step when the user's own granola server entry takes the place of Granola's. */
export const CONFLICT_NEXT = "Remove mcp.servers.granola from your OpenCode config to use Granola's official server."

export const NOTHING_TO_DO = "Nothing to do."

/**
 * The next step when nothing else is needed but OpenCode is outside the supported range and runs only because of
 * allowUntestedHost. An untested release inside the range leaves the next step unchanged.
 */
export const UNTESTED_HOST_NEXT = `If Granola misbehaves, use OpenCode ${TESTED_HOSTS.slice(0, -1).join(", ")} or ${TESTED_HOSTS.at(-1)}.`

/**
 * The fix for agents that missed the defaults, such as agents defined only in the user's config, worded the same in
 * every plugin of this family: the block goes first in each agent's own permissions, followed by the user's top-level
 * rules for Granola tools, so those keep winning. Never the top-level permissions: rules there apply to every agent
 * after its base rules, so the block would loosen stricter agents such as Explore.
 */
export const AGENT_FIX =
  "Put the default rules shown by /granola-status first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for Granola tools."

/** OpenCode loads one skill per id, so a user's skill with one of the plugin's ids takes the place of the plugin's own. */
function shadowedSkills(inputs: Pick<StatusInputs, "skills" | "bundledSkills">): ShadowedSkill[] {
  return inputs.bundledSkills.flatMap((own) =>
    inputs.skills.filter((skill) => skill.id === own.name && skill.path !== own.path).map((skill) => ({ name: own.name, path: skill.path })))
}

/** Rename or move the skills that take the place of the plugin's own, so OpenCode loads the plugin's. */
export function shadowedFix(skills: readonly ShadowedSkill[]): string {
  const list = (items: readonly string[]) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : items[0]!)
  const paths = list(skills.map((skill) => skill.path))
  const names = list(skills.map((skill) => skill.name))
  return skills.length > 1
    ? `Rename or move the skills at ${paths}, which use the ids of the plugin's ${names} skills, so OpenCode loads them instead of the plugin's own.`
    : `Rename or move the skill at ${paths}, which uses the id of the plugin's ${names} skill, so OpenCode loads it instead of the plugin's own.`
}

export function buildStatus(inputs: StatusInputs): Status {
  const server = inputs.servers.find((entry) => entry.name === SERVER)
  const connection: ConnectionState = server?.status.status ?? "absent"
  // The user's own granola server for another URL is a conflict, whatever its connection state.
  const problem = inputs.conflict ? undefined : connectionProblem(connection, server?.status.error)
  const classes = inputs.tools.map((tool) => ({ id: tool.id, kind: classify(tool.id) }))
  const unknown = classes.filter((tool) => tool.kind === "unknown").map((tool) => tool.id.slice(SERVER.length + 1))
  // Every Granola tool on the server that the model can call, unknown ones included; not the plugin's own export.
  const visible = classes.filter((tool) => tool.kind === "read" || tool.kind === "write" || tool.kind === "unknown").length
  const unguarded = unguardedAgents(inputs.agents)
  const shadowed = shadowedSkills(inputs)
  const nextStep = (inputs.conflict ? CONFLICT_NEXT : undefined)
    ?? problem?.next
    ?? (unguarded.length ? AGENT_FIX : undefined)
    ?? (shadowed.length ? shadowedFix(shadowed) : undefined)
    ?? (inputs.host.warning ? UNTESTED_HOST_NEXT : undefined)
    ?? NOTHING_TO_DO
  return {
    version: inputs.version,
    host: { version: inputs.host.version || null, range: inputs.host.range, tested: inputs.host.tested },
    state: inputs.conflict ? "conflict" : STATE_OF[connection],
    ...(connection === "connected" && !inputs.conflict && server?.title ? { title: server.title } : {}),
    ...(problem ? { problem: { code: problem.code, message: problem.message } } : {}),
    ...(inputs.conflict ? { conflict: inputs.conflict } : {}),
    tools: {
      visible,
      hidden: inputs.hidden,
      unknown: unknown.length,
      unknownNames: unknown.filter((name) => SAFE_NAME.test(name)).slice(0, LISTED_UNKNOWN),
    },
    ...(inputs.workspace ? { workspace: inputs.workspace } : {}),
    unguardedAgents: unguarded,
    ...(unguarded.length ? { permissionsBlock: DEFAULT_RULES.map((rule) => ({ ...rule })) } : {}),
    shadowedSkills: shadowed,
    exportDirectory: inputs.exportDirectory,
    ...(inputs.host.warning ? { hostWarning: inputs.host.warning } : {}),
    nextStep,
  }
}

/** /granola-status: the same rows as the dialog, as plain text, then exactly one Next step line. */
export function formatStatus(status: Status): string {
  const lines = ["Granola status"]
  for (const row of statusRows(status)) {
    lines.push(`${row.label}: ${row.text}`)
    for (const line of row.block ?? []) lines.push(`  ${line}`)
  }
  lines.push(`Next step: ${status.nextStep}`)
  return lines.join("\n")
}

export interface StatusSource {
  read(): Promise<Status>
}

export interface StatusContext {
  readonly mcp: Pick<Plugin.Context["mcp"], "list">
  readonly tool: Pick<Plugin.Context["tool"], "list">
  readonly agent: Pick<Plugin.Context["agent"], "list">
  readonly skill: Pick<Plugin.Context["skill"], "list">
}

/** Reads OpenCode's local state only; never calls Granola. A skill list that fails only hides shadowed skills. */
export function createStatus(ctx: StatusContext, fixed: () => Omit<StatusInputs, "servers" | "tools" | "agents" | "skills">): StatusSource {
  return {
    async read() {
      const [servers, tools, agents, skills] = await Promise.all([
        ctx.mcp.list(),
        ctx.tool.list(),
        ctx.agent.list(),
        ctx.skill.list().then((listed) => listed.data, () => []),
      ])
      return buildStatus({ ...fixed(), servers: servers.data, tools, agents: agents.data, skills })
    },
  }
}
