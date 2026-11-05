// The plugin's RPC contract, shared by the server and the TUI part, which imports it relatively. It imports
// nothing from the server implementation, so the TUI part loads it on its own.
import { Rpc } from "@opencode/plugin/rpc"

/** OpenCode's state for the granola MCP server; absent means no server of that name is registered. */
export type ConnectionState = "connected" | "pending" | "disabled" | "failed" | "needs_auth" | "absent"

/** A skill OpenCode loads under one of the plugin's skill ids, from another file, instead of the plugin's own. */
export interface ShadowedSkill {
  readonly name: string
  readonly path: string
}

export interface PermissionRule {
  readonly action: string
  readonly resource: string
  readonly effect: "allow" | "deny" | "ask"
}

/**
 * The status state, in the machine form every plugin of this family shares: OpenCode's connection state for the
 * granola server, or `conflict` when the user's own granola server, for another URL, holds the name.
 */
export type State = "connected" | "sign_in_required" | "connecting" | "disabled" | "failed" | "not_configured" | "conflict"

export const STATES: readonly State[] = ["connected", "sign_in_required", "connecting", "disabled", "failed", "not_configured", "conflict"]

/** The state for OpenCode's connection state; a conflict takes precedence in the status model. */
export const STATE_OF: Readonly<Record<ConnectionState, State>> = {
  connected: "connected",
  pending: "connecting",
  needs_auth: "sign_in_required",
  failed: "failed",
  disabled: "disabled",
  absent: "not_configured",
}

/**
 * One status model behind /granola-status, the TUI dialog and the RPC. JSON-safe, no secrets. `version`, `host`,
 * `state`, `unguardedAgents` and `nextStep` are the fields every plugin of this family shares.
 */
export interface Status {
  /** The plugin's version. */
  readonly version: string
  readonly host: {
    /** OpenCode's version; null when OpenCode reports none. */
    readonly version: string | null
    /** The supported range, `opencode.host` in package.json. */
    readonly range: string
    /** True only for a release in the tested list. */
    readonly tested: boolean
  }
  readonly state: State
  /** Granola's display title, once connected. */
  readonly title?: string
  /** Set whenever Granola is not connected; its next step is `nextStep`. */
  readonly problem?: { readonly code: string; readonly message: string }
  /** Set with the state `conflict`: the user's own granola server that holds the name. */
  readonly conflict?: string
  readonly tools: {
    /** Granola's own tools available now, unknown ones included; the plugin's export is not counted. */
    readonly visible: number
    /** Granola tools this plugin removed, such as sign_out. */
    readonly hidden: number
    /** Granola tools this plugin version does not know; they ask before running. */
    readonly unknown: number
    readonly unknownNames: readonly string[]
  }
  /** The active workspace from the most recent account read in this OpenCode run. */
  readonly workspace?: string
  /** Agents whose own rules would let a Granola tool this plugin does not know run without asking; empty when none. */
  readonly unguardedAgents: readonly string[]
  /**
   * Set with unguardedAgents: the rules to put first in each of those agents' own `permissions`, followed by
   * the user's top-level rules for Granola tools.
   */
  readonly permissionsBlock?: readonly PermissionRule[]
  /** Skills that take the place of the plugin's own because they use the same id; empty when none. */
  readonly shadowedSkills: readonly ShadowedSkill[]
  readonly exportDirectory: string
  /** Set only when allowUntestedHost lets a host outside the supported range run the plugin. */
  readonly hostWarning?: string
  /** Exactly one step, the Next step row; "Nothing to do." when nothing is needed. */
  readonly nextStep: string
}

/** JSON Schema for Status: the RPC method's output. */
export const STATUS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["version", "host", "state", "tools", "unguardedAgents", "shadowedSkills", "exportDirectory", "nextStep"],
  properties: {
    version: { type: "string" },
    host: {
      type: "object",
      additionalProperties: false,
      required: ["version", "range", "tested"],
      properties: { version: { type: ["string", "null"] }, range: { type: "string" }, tested: { type: "boolean" } },
    },
    state: { type: "string", enum: STATES },
    title: { type: "string" },
    problem: {
      type: "object",
      additionalProperties: false,
      required: ["code", "message"],
      properties: { code: { type: "string" }, message: { type: "string" } },
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
    shadowedSkills: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "path"],
        properties: { name: { type: "string" }, path: { type: "string" } },
      },
    },
    exportDirectory: { type: "string" },
    hostWarning: { type: "string" },
    nextStep: { type: "string" },
  },
} as const

/** The status RPC's one error: status could not be read. Its data is the code and the next step. */
export const STATUS_ERROR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["code", "next"],
  properties: { code: { type: "string" }, next: { type: "string" } },
} as const

/** The S9 labels for the states, shared by /granola-status and the TUI dialog. */
export const STATE_LABELS: Readonly<Record<State, string>> = {
  connected: "connected",
  connecting: "connecting",
  sign_in_required: "sign-in required",
  failed: "failed",
  disabled: "disabled",
  not_configured: "not configured",
  conflict: "conflict",
}

export type Tone = "ok" | "info" | "warning" | "error"

const TONES: Readonly<Record<State, Tone>> = {
  connected: "ok",
  connecting: "info",
  sign_in_required: "warning",
  failed: "error",
  disabled: "info",
  not_configured: "warning",
  conflict: "warning",
}

/** One status row. The block, when set, is config to paste, one line each. */
export interface StatusRow {
  readonly label: string
  readonly text: string
  readonly tone?: Tone
  readonly block?: readonly string[]
}

function hostRow(status: Status): StatusRow {
  const { version, range, tested } = status.host
  const found = version ?? "unknown"
  if (status.hostWarning) return { label: "OpenCode", text: `${found} (host untested: ${status.hostWarning}), plugin ${status.version}`, tone: "warning" }
  return { label: "OpenCode", text: `${found} (${tested ? "tested" : "untested"}; supported range ${range}), plugin ${status.version}`, ...(tested ? {} : { tone: "info" as const }) }
}

/** The rows /granola-status and the dialog show, in order; the Next step line follows them. */
export function statusRows(status: Status): StatusRow[] {
  const connected = status.state === "connected"
  const connection = status.state === "conflict" && status.conflict ? `conflict: ${status.conflict}`
    : `${STATE_LABELS[status.state]}${status.title ? ` (${status.title})` : ""}${status.problem ? `: ${status.problem.message} (${status.problem.code})` : ""}`
  const tools = [`${status.tools.visible} available`]
  if (status.tools.hidden) tools.push(`${status.tools.hidden} hidden`)
  if (status.tools.unknown) {
    const named = status.tools.unknownNames.length ? `: ${status.tools.unknownNames.join(", ")}` : ""
    tools.push(`${status.tools.unknown} unknown, asking before they run${named}`)
  }
  const agents = status.unguardedAgents
  return [
    { label: "Connection", text: connection, tone: TONES[status.state] },
    { label: "Account", text: !connected ? "unknown until Granola connects" : status.workspace ? `workspace ${status.workspace}` : "workspace unknown until the agent reads your Granola account" },
    { label: "Access", text: "reads run without asking; changes, new tools and exports ask first; give_feedback is off" },
    { label: "Export folder", text: status.exportDirectory },
    status.shadowedSkills.length
      ? { label: "Skills", text: status.shadowedSkills.map((skill) => `${skill.name} is replaced by ${skill.path}`).join("; "), tone: "warning" as const }
      : { label: "Skills", text: "the plugin's own" },
    { label: "Tools", text: connected ? tools.join(", ") : "none until Granola connects" },
    agents.length
      ? {
          label: "Agents without default rules",
          text: agents.join(", "),
          tone: "warning" as const,
          block: permissionsSnippet(agents, status.permissionsBlock ?? []),
        }
      : { label: "Agents without default rules", text: "none" },
    hostRow(status),
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
    `      ...then your top-level rules for Granola tools, then the agent's other rules`,
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
      errors: { unavailable: STATUS_ERROR_SCHEMA },
    },
  },
  events: {},
})
