/**
 * The provider: Granola's official MCP server, reached through OpenCode's own MCP tool executors.
 *
 * OpenCode registers one remote MCP server per account alias (`granola`, `granola-work`, …) and owns every OAuth
 * token. This module is the only place the server URL is named, and the only place that turns an alias into a server
 * name and a tool id. It never reads a credential.
 */
import type { Plugin } from "@opencode/plugin"
import type { ToolContext } from "@opencode/plugin/promise/tool"
import { accountName, redactReason, type AccountState } from "@we-the-rebel-alliance/plugin-contract/accounts"
import { SourceError } from "@we-the-rebel-alliance/plugin-contract/events"
import type { Owner } from "@we-the-rebel-alliance/plugin-contract/manifest"
import { accountEmail, accountPlan, accountScopes } from "./granola.ts"

/** Granola's official remote MCP server. Every alias registers the same endpoint under its own server name. */
export const MCP_URL = "https://mcp.granola.ai/mcp"

type Tool = Awaited<ReturnType<Plugin.Context["tool"]["list"]>>[number]
type Result = Awaited<ReturnType<Tool["execute"]>>

/** The parts of the plugin context the provider reads. */
export interface ProviderContext {
  readonly tool: Pick<Plugin.Context["tool"], "list">
  readonly mcp: Pick<Plugin.Context["mcp"], "list">
}

/** What a handler knows about the call: enough to run a vendor tool as the same session and agent. */
export interface CallContext {
  readonly sessionID: string
  readonly agent: string
  readonly messageID: string
  readonly id: string
  readonly signal: AbortSignal
  readonly progress: (update?: Readonly<Record<string, unknown>>) => Promise<void>
  readonly door: "tool" | "codemode" | "rpc"
}

/** One alias's connection state, as `status` reports it. */
export interface ServerState {
  readonly state: AccountState
  readonly reason?: string
  /** The MCP server name a person signs in to. */
  readonly server: string
}

/** A tool read bound to one call and one alias. */
export type Read = (tool: string, input: Record<string, unknown>) => Promise<Result>

/** What `get_account_info` names for an alias. */
export interface AccountRead {
  readonly owner: Owner
  readonly scopes?: readonly string[]
  readonly plan?: string
}

/** The provider's one entry point. */
export interface Provider {
  /** Run one of Granola's tools for an alias, as the calling session's agent. */
  call(call: CallContext, alias: string, tool: string, input: Record<string, unknown>): Promise<Result>
  /** A `call` bound to one alias. */
  reader(call: CallContext, alias: string): Read
  /** The owner a probe or an earlier read recorded for an alias, if any. */
  owner(alias: string): Owner | undefined
  /** The account's live MCP connection state, for `status`. */
  serverState(alias: string): Promise<ServerState>
  /** Read `get_account_info`, record the owner and plan for the alias, and return them. */
  probe(call: CallContext, alias: string): Promise<AccountRead>
  /** Ensure the alias's owner is known: the cached one, or one `get_account_info` read. */
  ensureOwner(call: CallContext, alias: string): Promise<Owner>
  /** Record the signed-in email a `get_meetings` answer named; another email for the alias is ACCOUNT_MISMATCH. */
  recordEmail(alias: string, email: string, plan?: string): Owner
  /** Whether the alias's MCP server currently offers a tool. */
  has(alias: string, tool: string): Promise<boolean>
  /** The plan a probe recorded for an alias within `ttlMs`; undefined when none is, or it named none. */
  planOf(alias: string, now: number, ttlMs: number): string | undefined
}

const SIGN_IN = (server: string) => ({
  code: "NEEDS_SIGN_IN" as const,
  what: `${server} needs a Granola sign-in`,
  next: `Sign in to the MCP server ${server} through OpenCode, then try again.`,
})

const UNAVAILABLE = (what: string) => ({
  code: "UNAVAILABLE" as const,
  what,
  next: "Try again; if it keeps failing, check the plugin's status.",
})

/** The tool id OpenCode gives an MCP tool: the server name, an underscore, and the tool's own name. */
function toolID(server: string, tool: string): string {
  return `${server.replaceAll(".", "_")}_${tool}`
}

/** A provider over OpenCode's MCP tool executors and connection list. */
export function createProvider(context: ProviderContext, plugin: string, clock: () => number = Date.now): Provider {
  const owners = new Map<string, Owner>()
  const plans = new Map<string, { readonly plan: string | undefined; readonly at: number }>()

  const toolContext = (call: CallContext): ToolContext =>
    ({
      sessionID: call.sessionID,
      agent: call.agent,
      messageID: call.messageID,
      id: call.id,
      signal: call.signal,
      progress: (update: Record<string, unknown>) => call.progress(update),
      codemode: call.door === "codemode",
    }) as unknown as ToolContext

  async function serverState(alias: string): Promise<ServerState> {
    const server = accountName(plugin, alias)
    const entry = (await context.mcp.list()).data.find((candidate) => candidate.name === server)
    if (entry === undefined) return { state: "error", reason: `no MCP server is named ${server}`, server }
    switch (entry.status.status) {
      case "connected":
        return { state: "ready", server }
      case "needs_auth":
        return { state: "needs_sign_in", reason: redactReason(entry.status.error), server }
      case "failed":
        return { state: "error", reason: redactReason(entry.status.error), server }
      case "disabled":
        return { state: "error", reason: `the MCP server ${server} is disabled`, server }
      case "pending":
        return { state: "error", reason: `the MCP server ${server} has not connected yet`, server }
    }
  }

  async function call(callContext: CallContext, alias: string, tool: string, input: Record<string, unknown>): Promise<Result> {
    const server = accountName(plugin, alias)
    const id = toolID(server, tool)
    const tools = await context.tool.list()
    const found = tools.find((entry) => entry.id === id)
    if (found === undefined) {
      const state = await serverState(alias)
      if (state.state === "needs_sign_in") throw new SourceError(SIGN_IN(server))
      throw new SourceError(UNAVAILABLE(`${server} does not offer ${tool} for ${alias}${state.reason === undefined ? "" : ` (${state.reason})`}`))
    }
    try {
      return await found.execute(input as never, toolContext(callContext))
    } catch (error) {
      if (error instanceof SourceError) throw error
      const state = await serverState(alias)
      const reason = redactReason(error instanceof Error ? error.message : String(error))
      if (state.state === "needs_sign_in" || /needs? (?:auth|sign-in)|unauthori[sz]ed|\b401\b/i.test(reason)) {
        throw new SourceError(SIGN_IN(server))
      }
      throw new SourceError(UNAVAILABLE(`Granola's ${tool} failed for ${alias}: ${reason}`))
    }
  }

  function owner(alias: string): Owner | undefined {
    return owners.get(alias)
  }

  async function has(alias: string, tool: string): Promise<boolean> {
    const id = toolID(accountName(plugin, alias), tool)
    return (await context.tool.list()).some((entry) => entry.id === id)
  }

  function recordEmail(alias: string, email: string, plan?: string): Owner {
    const owner: Owner = { id: `mailto:${email}`, label: email }
    const known = owners.get(alias)
    if (known !== undefined && known.id !== owner.id) {
      throw new SourceError({
        code: "ACCOUNT_MISMATCH",
        what: `${alias} was signed in as ${known.label}, and Granola now answers as ${email}`,
        next: `Sign ${alias} out and in again with the account it should use, then retry.`,
      })
    }
    owners.set(alias, owner)
    if (plan !== undefined) plans.set(alias, { plan, at: clock() })
    return owner
  }

  async function probe(callContext: CallContext, alias: string): Promise<AccountRead> {
    const result = await call(callContext, alias, "get_account_info", {})
    const email = accountEmail(result)
    if (email === undefined) {
      throw new SourceError({
        code: "NEEDS_SIGN_IN",
        what: `Granola did not name the signed-in account for ${alias}`,
        next: `Sign in to the MCP server ${accountName(plugin, alias)} again, then retry.`,
      })
    }
    const plan = accountPlan(result)
    const owner = recordEmail(alias, email, plan)
    const scopes = accountScopes(result)
    return { owner, ...(scopes === undefined ? {} : { scopes }), ...(plan === undefined ? {} : { plan }) }
  }

  async function ensureOwner(callContext: CallContext, alias: string): Promise<Owner> {
    const known = owners.get(alias)
    if (known !== undefined) return known
    return (await probe(callContext, alias)).owner
  }

  /** The plan a probe recorded for an alias within `ttlMs`; undefined when none is, or it named none. */
  function planOf(alias: string, now: number, ttlMs: number): string | undefined {
    const entry = plans.get(alias)
    return entry !== undefined && now - entry.at <= ttlMs && now >= entry.at ? entry.plan : undefined
  }

  return {
    call,
    reader: (callContext, alias) => (tool, input) => call(callContext, alias, tool, input),
    owner,
    serverState,
    probe,
    ensureOwner,
    recordEmail,
    planOf,
    has,
  }
}
