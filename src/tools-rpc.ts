/**
 * Granola's part of the tools RPC (`granola.meetings.tools`): the plugin value and the method table that the source
 * contract's `tools-rpc` module takes. The module (`@we-the-rebel-alliance/source-contract/tools-rpc`, bundled into
 * `dist/index.js`) is the transport every plugin of the family shares:
 *
 *   POST /api/rpc/granola.meetings.tools/<method>
 *   { "input": { "sessionID": "<session>", "input": <the tool's input> } }
 *
 * A script runs as a session and the agent it names; the rule for the method's permission action is resolved before
 * dispatch, and only `allow` runs. An MCP method then runs through OpenCode's own executor, which checks
 * `granola_<tool>` against the same rules and sends OpenCode's own credential; the plugin's own methods run their own
 * specs. `docs/scripting.md` describes the calls.
 */
import type { Plugin } from "@opencode/plugin"
import type { Failure, McpResult, MethodSpec, NextSteps, PluginMethod, ShapeCall, ToolsRpcPlugin } from "@we-the-rebel-alliance/source-contract/tools-rpc"
import { toolsRpcId } from "@we-the-rebel-alliance/source-contract/tools-rpc"
import { EventsFailure } from "./events/errors.js"
import { connectionProblem, toolUnavailable } from "./errors.js"
import { EXPORT_DESCRIPTION, EXPORT_INPUT, EXPORT_OUTPUT, exportMarkdown } from "./export/index.js"
import { PLUGIN_ID } from "./meta.js"
import type { ConnectionState } from "./rpc/contract.js"
import { CONFLICT_NEXT } from "./status.js"
import { captureWorkspace } from "./tools.js"
import { READ_TOOLS, WRITE_TOOLS, toolID } from "./known-tools.js"

/** The RPC's id: the plugin's id and `.tools`, `granola.meetings.tools`. Scripts call it by name, so it never changes. */
export const TOOLS_RPC_ID = toolsRpcId(PLUGIN_ID)

/**
 * Every known tool, by its upstream name, with its class. The table is `src/known-tools.ts`, the one list the default
 * rules, this module and the skills read: the ten reads of today's server, its ten writes, and the plugin's own
 * export. `give_feedback` sends to Granola's team, so it is a send; like every other tool it is allowed at the default
 * `access`. `sign_out` is not a tool this plugin offers (it removes it from the registry), so it is not here. A tool
 * the server adds later is not a method; `describe` lists it as unclassified.
 */
export const METHODS: readonly MethodSpec[] = [
  ...READ_TOOLS.map((name): MethodSpec => ({ kind: "mcp", name, class: "read" })),
  ...WRITE_TOOLS.map((name): MethodSpec => ({ kind: "mcp", name, class: name === "give_feedback" ? "send" : "write" })),
]

/**
 * The export's output for an RPC method. The tool's own schema marks the checksum with a pattern; OpenCode's RPC
 * output validation refuses patterns as unsafe, so this copy has the same fields without one.
 */
const EXPORT_RPC_OUTPUT = {
  type: "object",
  additionalProperties: false,
  required: [...EXPORT_OUTPUT.required],
  properties: {
    path: { type: "string" },
    bytes: { type: "integer", minimum: 0 },
    sha256: { type: "string" },
  },
} as const

/**
 * The plugin's own export tool, built in setup where it has the plugin's context and its export folder. It runs the
 * tool's own `exportMarkdown`, which confines the file to the export root and asserts `granola_export_markdown`.
 */
export function exportMethod(ctx: Plugin.Context, exportDirectory: string): PluginMethod {
  return {
    kind: "plugin",
    name: "export_markdown",
    action: toolID("export_markdown"),
    class: "export",
    description: EXPORT_DESCRIPTION,
    input: EXPORT_INPUT,
    output: EXPORT_RPC_OUTPUT,
    async run(input, call) {
      return (await exportMarkdown({ ctx: ctx as never, exportDirectory }, input, call as never)).output
    },
  }
}

/**
 * What the model path's `execute.after` hook does to a result, which the executor skips: an account read records the
 * workspace that status shows. The hook's other job, naming a server that is not connected, is the module's own
 * mapping, with the same codes and the next steps below.
 */
export function shapeInput(_method: string, input: unknown, _call: ShapeCall): unknown {
  return input
}

export function shapeResult(method: string, result: McpResult, _call: ShapeCall): McpResult {
  if (method === "get_account_info") captureWorkspace(result as never)
  return result
}

/** The connection table's next step for a state, as the model path gives it. */
const connectionNext = (state: ConnectionState) => connectionProblem(state)?.next ?? ""

/** The next step for each code. Each is one sentence that ends with a full stop. */
export const NEXT_STEPS: NextSteps = {
  SESSION_UNKNOWN: `Create a session in the location you mean, such as POST /api/session with {"agent":"build"} sent with the header "x-opencode-directory: <dir>" or the location[directory] query, and pass its id.`,
  SESSION_AGENT_REQUIRED: `Create a session that names an agent this project has, with its project as the location, such as POST /api/session with {"agent":"build","location":{"directory":"/path/to/project"}}, and pass its id.`,
  PERMISSION_DENIED: "Add an allow rule for the tool to the session's agent or to the session, or use a session whose agent allows it.",
  SERVER_CONFLICT: CONFLICT_NEXT,
  AUTH_REQUIRED: connectionNext("needs_auth"),
  CONNECTING: connectionNext("pending"),
  CONNECTION_FAILED: connectionNext("failed"),
  DISABLED: connectionNext("disabled"),
  NOT_REGISTERED: connectionNext("absent"),
  TOOL_UNAVAILABLE: toolUnavailable("the tool").next,
  UPSTREAM_ERROR: "Check the input against the method's schema from describe, and run /granola-status if it keeps failing.",
  CANCELLED: "Call the method again if you still need the result.",
}

/** The plugin's own errors, thrown by plugin-owned specs, as a code, what happened and the next step: events_list's and probe's. */
export function pluginError(error: unknown): Failure | undefined {
  if (!(error instanceof EventsFailure)) return undefined
  const { code, message, next } = error.problem
  return { code, what: message.replace(/[.\s]+$/, ""), next }
}

/** Granola's plugin value for the tools RPC. */
export const PLUGIN: ToolsRpcPlugin = { id: PLUGIN_ID, nextSteps: NEXT_STEPS, shapeInput, shapeResult, pluginError }
