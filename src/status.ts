import type { Plugin } from "@opencode/plugin"
import { connectionProblem, type ConnectionState } from "./errors.js"
import type { HostCheck } from "./host-check.js"
import { SERVER, classify } from "./known-tools.js"
import { DEFAULT_RULES, unguardedAgents, type Rule } from "./permissions.js"
import { STATE_OF, statusRows, type Status } from "./rpc/contract.js"
import { TESTED_HOSTS } from "./hosts.js"

// The status model's wire shape lives in the RPC contract, so clients load it without the server code.
export { STATUS_SCHEMA, type Status } from "./rpc/contract.js"

export interface StatusInputs {
  readonly servers: readonly { readonly name: string; readonly title?: string; readonly status: { readonly status: Exclude<ConnectionState, "absent">; readonly error?: string } }[]
  readonly tools: readonly { readonly id: string }[]
  readonly agents: readonly { readonly id: string; readonly permissions: readonly Readonly<Rule>[] }[]
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
 * The fix for agents that missed the defaults, such as agents defined only in the user's config: the block goes
 * first in each agent's own permissions, followed by the user's top-level rules for granola_ actions, so those keep
 * winning. Never the top-level permissions: rules there apply to every agent after its base rules, so the block
 * would loosen stricter agents such as Explore.
 */
export function agentFix(agents: readonly string[]): string {
  const where = agents.map((agent) => `agents.${agent}.permissions`).join(", ")
  return `Put the Granola block first in that agent's own permissions (${where}), followed by your top-level rules for granola_ actions.`
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
  const nextStep = (inputs.conflict ? CONFLICT_NEXT : undefined)
    ?? problem?.next
    ?? (unguarded.length ? agentFix(unguarded) : undefined)
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
}

/** Reads OpenCode's local state only; never calls Granola. */
export function createStatus(ctx: StatusContext, fixed: () => Omit<StatusInputs, "servers" | "tools" | "agents">): StatusSource {
  return {
    async read() {
      const [servers, tools, agents] = await Promise.all([ctx.mcp.list(), ctx.tool.list(), ctx.agent.list()])
      return buildStatus({ ...fixed(), servers: servers.data, tools, agents: agents.data })
    },
  }
}
