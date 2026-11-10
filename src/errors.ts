import { Error as ToolError } from "@opencode/plugin/promise/tool"
import type { ConnectionState } from "./rpc/contract.js"

export type Code =
  | "NOT_REGISTERED"
  | "CONNECTING"
  | "AUTH_REQUIRED"
  | "CONNECTION_FAILED"
  | "DISABLED"
  | "TOOL_UNAVAILABLE"
  | "HOST_UNTESTED"
  | "OPTIONS_INVALID"
  | "STATUS_UNAVAILABLE"
  | "SKILLS_INVALID"
  | "PACKAGE_INVALID"
  | "EXPORT_INVALID_INPUT"
  | "EXPORT_INVALID_PATH"
  | "EXPORT_EXISTS"
  | "EXPORT_TOO_LARGE"
  | "EXPORT_READ_FAILED"
  | "EXPORT_WRITE_FAILED"
  | "EXPORT_PATH_NOT_PERMITTED"
  | "EVENTS_INVALID_INPUT"
  | "EVENTS_CURSOR_INVALID"
  | "EVENTS_ACCOUNT_UNKNOWN"
  | "EVENTS_SOURCE_UNKNOWN"
  | "EVENTS_OWNER_UNKNOWN"
  | "EVENTS_READ_FAILED"

/**
 * Every code the plugin's own code raises, as one table. The README's Troubleshooting table names each one, and
 * `test/error-tables.test.ts` fails when the two differ either way or a code appears here that nothing raises.
 */
export const PLUGIN_CODES = [
  "NOT_REGISTERED",
  "CONNECTING",
  "AUTH_REQUIRED",
  "CONNECTION_FAILED",
  "DISABLED",
  "TOOL_UNAVAILABLE",
  "HOST_UNTESTED",
  "OPTIONS_INVALID",
  "STATUS_UNAVAILABLE",
  "SKILLS_INVALID",
  "PACKAGE_INVALID",
  "EXPORT_INVALID_INPUT",
  "EXPORT_INVALID_PATH",
  "EXPORT_EXISTS",
  "EXPORT_TOO_LARGE",
  "EXPORT_READ_FAILED",
  "EXPORT_WRITE_FAILED",
  "EXPORT_PATH_NOT_PERMITTED",
  "EVENTS_INVALID_INPUT",
  "EVENTS_CURSOR_INVALID",
  "EVENTS_ACCOUNT_UNKNOWN",
  "EVENTS_SOURCE_UNKNOWN",
  "EVENTS_OWNER_UNKNOWN",
  "EVENTS_READ_FAILED",
] as const satisfies readonly Code[]

/**
 * The codes the tools RPC gives a script: the ones `docs/scripting.md` documents. Most come from the shared tools RPC
 * module and from OpenCode's own connection state; they are the same names the model gets.
 */
export const RPC_CODES = [
  "PERMISSION_DENIED",
  "SESSION_UNKNOWN",
  "SESSION_AGENT_REQUIRED",
  "TOOL_UNAVAILABLE",
  "SERVER_CONFLICT",
  "AUTH_REQUIRED",
  "CONNECTING",
  "CONNECTION_FAILED",
  "DISABLED",
  "NOT_REGISTERED",
  "UPSTREAM_ERROR",
  "CANCELLED",
] as const

/** Every user-facing failure: a stable code, what happened, and what to do next, in plain text. */
export interface Problem {
  readonly code: Code
  readonly message: string
  readonly next: string
}

const SIGN_IN_STEPS =
  "Run /connect and choose Granola, then press o or Enter to open the sign-in page (in a terminal, opencode mcp auth granola opens it automatically)."

export function describe(problem: Problem): string {
  return `${problem.code}: ${problem.message} Next step: ${problem.next}`
}

/** Thrown from setup, where the host shows the message on the failed plugin. */
export class GranolaError extends Error {
  readonly code: Code

  constructor(readonly problem: Problem) {
    super(describe(problem))
    this.name = "GranolaError"
    this.code = problem.code
  }
}

/** The model-facing form. Tool.Error is exported only from this public Promise API subpath. */
export function toolError(problem: Problem): ToolError {
  return new ToolError({ message: describe(problem), metadata: { code: problem.code, next: problem.next } })
}

/** Host failure text can carry URLs; keep a short, single-line reason without them. */
export function shortReason(text: string | undefined): string {
  const reason = (text ?? "")
    .replace(/\bhttps?:\/\/\S+/gi, "<url>")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.\s]+$/, "")
  if (!reason) return "no reason given"
  return reason.length > 160 ? `${reason.slice(0, 157)}...` : reason
}

/** Ends a reason with a full stop, unless it already ends a sentence, as "Is the computer able to access the url?" does. */
const sentence = (reason: string) => (/[.?!]$/.test(reason) ? reason : `${reason}.`)

/** The row of the connection-state table; undefined when Granola is connected. */
export function connectionProblem(state: ConnectionState, error?: string): Problem | undefined {
  switch (state) {
    case "connected":
      return undefined
    case "absent":
      return {
        code: "NOT_REGISTERED",
        message: "The Granola connection isn't registered yet.",
        next: "Retry in a few seconds; if it persists, check that no organisation policy (mcp.use) or other plugin removes the granola server, then restart OpenCode.",
      }
    case "pending":
      return { code: "CONNECTING", message: "Granola is still connecting.", next: "Retry in a few seconds." }
    case "needs_auth":
      // The host's needs_auth text can contain an authorization URL, so it is never echoed.
      return { code: "AUTH_REQUIRED", message: "Granola needs you to sign in.", next: SIGN_IN_STEPS }
    case "failed":
      return {
        code: "CONNECTION_FAILED",
        message: `Granola connection failed: ${sentence(shortReason(error))}`,
        next: "Reconnect Granola from /mcps, and if it keeps failing, run /connect and choose Granola to sign in again.",
      }
    case "disabled":
      return {
        code: "DISABLED",
        message: "Granola is disabled in OpenCode.",
        next: 'Enable granola in /mcps, or remove "disabled": true from mcp.servers.granola in your OpenCode config.',
      }
  }
}

export function toolUnavailable(tool: string): Problem {
  return {
    code: "TOOL_UNAVAILABLE",
    message: `Granola does not offer ${tool} for this account.`,
    next: "Your Granola plan may not include it; run /granola-status to see the tools Granola offers you.",
  }
}

export const STATUS_UNAVAILABLE: Problem = {
  code: "STATUS_UNAVAILABLE",
  message: "Granola status could not be read.",
  next: "Run /granola-status again in a few seconds.",
}

/**
 * Writing outside the project needs two rules: the export's own action and OpenCode's `external_directory`. This is the
 * refusal when the second one is missing, and its next step is the rule itself.
 */
export function externalDirectory(folder: string): Problem {
  return {
    code: "EXPORT_PATH_NOT_PERMITTED",
    message: `OpenCode asks for the external_directory permission before anything outside the project is written, and the export folder ${folder} is outside it.`,
    next: `Allow it with { "action": "external_directory", "resource": "${folder}/*", "effect": "allow" } in your permissions, or set exportDirectory inside the project.`,
  }
}

export function invalidOption(key: string, problem: string): Problem {
  return {
    code: "OPTIONS_INVALID",
    message: `Plugin option ${key} ${problem}.`,
    next: "Fix the Granola plugin options in your OpenCode config, then reload OpenCode.",
  }
}

export function hostUntested(range: string, found: string): Problem {
  return {
    code: "HOST_UNTESTED",
    message: `The Granola plugin supports OpenCode ${range}, found ${found || "no version"}.`,
    next: `Use OpenCode ${range}, or set the plugin option allowUntestedHost to true to run anyway.`,
  }
}

export function skillsInvalid(path: string): Problem {
  return {
    code: "SKILLS_INVALID",
    message: `The bundled skill ${path} needs front matter with a name that matches its folder and a description.`,
    next: "Reinstall the plugin.",
  }
}

export function packageInvalid(problem: string): Problem {
  return { code: "PACKAGE_INVALID", message: `The Granola plugin's package.json ${problem}.`, next: "Reinstall the plugin." }
}
