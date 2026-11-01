// The plugin's RPC contract, shared by the server and the TUI part, which imports it relatively. It imports
// nothing from the server implementation, so the TUI part loads it on its own.
import { Rpc } from "@opencode/plugin/rpc"

/** OpenCode's state for the granola MCP server; absent means no server of that name is registered. */
export type ConnectionState = "connected" | "pending" | "disabled" | "failed" | "needs_auth" | "absent"

export interface PermissionRule {
  readonly action: string
  readonly resource: string
  readonly effect: "allow" | "deny" | "ask"
}

/** One status model behind /granola-status and the TUI dialog's RPC. JSON-safe, no secrets. */
export interface Status {
  readonly state: ConnectionState
  /** Granola's display title, once connected. */
  readonly title?: string
  /** Set whenever Granola is not connected. */
  readonly problem?: { readonly code: string; readonly message: string; readonly next: string }
  /** Set when the user's config already uses the granola server name for something else. */
  readonly conflict?: string
  readonly tools: {
    /** Known Granola tools available now. */
    readonly visible: number
    /** Granola tools this plugin removed, such as sign_out. */
    readonly hidden: number
    /** Granola tools this plugin version does not know; they ask before running. */
    readonly unknown: number
    readonly unknownNames: readonly string[]
  }
  /** The active workspace from the most recent account read in this OpenCode run. */
  readonly workspace?: string
  /** Agents that did not receive the Granola permission defaults, so Granola writes run there without asking. */
  readonly unguardedAgents: readonly string[]
  /**
   * Set with unguardedAgents: the rules to put first in each of those agents' own `permissions`, followed by
   * the user's top-level rules for Granola tools.
   */
  readonly permissionsBlock?: readonly PermissionRule[]
  readonly exportDirectory: string
  readonly pluginVersion: string
  readonly hostVersion: string
  readonly hostWarning?: string
  /** Exactly one step; "Nothing to do." when nothing is needed. */
  readonly next: string
}

/** JSON Schema for Status: the RPC method's output. */
export const STATUS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["state", "tools", "unguardedAgents", "exportDirectory", "pluginVersion", "hostVersion", "next"],
  properties: {
    state: { type: "string", enum: ["connected", "pending", "disabled", "failed", "needs_auth", "absent"] },
    title: { type: "string" },
    problem: {
      type: "object",
      additionalProperties: false,
      required: ["code", "message", "next"],
      properties: { code: { type: "string" }, message: { type: "string" }, next: { type: "string" } },
    },
    conflict: { type: "string" },
    tools: {
      type: "object",
      additionalProperties: false,
      required: ["visible", "hidden", "unknown", "unknownNames"],
      properties: {
        visible: { type: "integer", minimum: 0 },
        hidden: { type: "integer", minimum: 0 },
        unknown: { type: "integer", minimum: 0 },
        unknownNames: { type: "array", items: { type: "string" } },
      },
    },
    workspace: { type: "string" },
    unguardedAgents: { type: "array", items: { type: "string" } },
    permissionsBlock: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["action", "resource", "effect"],
        properties: {
          action: { type: "string" },
          resource: { type: "string" },
          effect: { type: "string", enum: ["allow", "deny", "ask"] },
        },
      },
    },
    exportDirectory: { type: "string" },
    pluginVersion: { type: "string" },
    hostVersion: { type: "string" },
    hostWarning: { type: "string" },
    next: { type: "string" },
  },
} as const

/** Labels for the connection states, shared by /granola-status and the TUI dialog. */
export const STATE_LABELS: Readonly<Record<ConnectionState, string>> = {
  connected: "connected",
  pending: "connecting",
  needs_auth: "sign-in required",
  failed: "failed",
  disabled: "disabled",
  absent: "not configured",
}

export type Tone = "ok" | "info" | "warning" | "error"

const TONES: Readonly<Record<ConnectionState, Tone>> = {
  connected: "ok",
  pending: "info",
  needs_auth: "warning",
  failed: "error",
  disabled: "info",
  absent: "warning",
}

/** One status row. The block, when set, is config to paste, one line each. */
export interface StatusRow {
  readonly label: string
  readonly text: string
  readonly tone?: Tone
  readonly block?: readonly string[]
}

/** The rows /granola-status and the dialog show, in order; the Next step line follows them. */
export function statusRows(status: Status): StatusRow[] {
  const connected = status.state === "connected"
  // The user's own granola server in place of Granola's is a conflict, whatever its connection state.
  const connection = status.conflict ? `conflict: ${status.conflict}`
    : `${STATE_LABELS[status.state]}${status.title ? ` (${status.title})` : ""}${status.problem ? `: ${status.problem.message} (${status.problem.code})` : ""}`
  const tools = [`${status.tools.visible} available`]
  if (status.tools.hidden) tools.push(`${status.tools.hidden} hidden`)
  if (status.tools.unknown) {
    const named = status.tools.unknownNames.length ? `: ${status.tools.unknownNames.join(", ")}` : ""
    tools.push(`${status.tools.unknown} unknown, asking before they run${named}`)
  }
  const agents = status.unguardedAgents
  return [
    { label: "Connection", text: connection, tone: status.conflict ? "warning" : TONES[status.state] },
    { label: "Account", text: !connected ? "unknown until Granola connects" : status.workspace ? `workspace ${status.workspace}` : "workspace unknown until the agent reads your Granola account" },
    { label: "Access", text: "reads run without asking; changes, new tools and exports ask first" },
    { label: "Export folder", text: status.exportDirectory },
    { label: "Tools", text: connected ? tools.join(", ") : "none until Granola connects" },
    ...(agents.length ? [{
      label: "Agents without default rules",
      text: `${agents.join(", ")}: Granola writes run there without asking`,
      tone: "warning" as const,
      block: permissionsSnippet(agents, status.permissionsBlock ?? []),
    }] : []),
    status.hostWarning
      ? { label: "OpenCode", text: `${status.hostVersion} (host untested: ${status.hostWarning}), plugin ${status.pluginVersion}`, tone: "warning" as const }
      : { label: "OpenCode", text: `${status.hostVersion} (tested), plugin ${status.pluginVersion}` },
  ]
}

/** The config snippet that gives agents the permission block, written out for the first agent. */
export function permissionsSnippet(agents: readonly string[], block: readonly PermissionRule[]): string[] {
  const [first, ...rest] = agents
  return [
    `"agents": {`,
    `  ${JSON.stringify(first)}: {`,
    `    "permissions": [`,
    ...block.map((rule) => `      ${JSON.stringify(rule)},`),
    `      ...then your top-level rules for granola_ actions, then the agent's other rules`,
    `    ]`,
    `  }${rest.length ? "," : ""}`,
    ...(rest.length ? [`  ...the same for ${rest.map((agent) => JSON.stringify(agent)).join(", ")}`] : []),
    `}`,
  ]
}

/** One read-only method, `status`, called with `{}`. Its output is a Status. */
export const Granola = Rpc.define({
  id: "granola.meetings",
  methods: {
    status: {
      input: { type: "object", properties: {}, additionalProperties: false },
      output: STATUS_SCHEMA,
    },
  },
  events: {},
})
