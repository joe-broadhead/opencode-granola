/**
 * `status`: the plugin's version, host, one entry per alias and any next step. It carries no content and no credential.
 *
 * The owner is the address a probe or an earlier read recorded for the alias; the alias's live MCP connection state
 * comes from the host. `call.unguardedAgents()` answers a value, never throws; `statusAnswer` turns a failed agent list
 * into a problem so `state` says `error`, never a false zero.
 */
import { accountStatuses, STATUS_SCHEMA, statusAnswer, type AccountSignal } from "@we-the-rebel-alliance/plugin-contract/accounts"
import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import { EMPTY } from "./shared.ts"
import type { HandlerRuntime } from "./index.ts"

/** `status`: name, version, host, state, one entry per alias, unguarded agents and a next step. */
export function statusHandler(runtime: HandlerRuntime): MethodHandler {
  return {
    description: "Read the plugin's version, OpenCode host, account status and any next step.",
    input: EMPTY,
    output: STATUS_SCHEMA,
    async run(_input, call) {
      const signals: Record<string, AccountSignal> = {}
      for (const account of runtime.accounts) {
        const state = await runtime.provider.serverState(account.alias)
        const owner = runtime.provider.owner(account.alias)
        signals[account.alias] = {
          state: state.state,
          ...(owner === undefined ? {} : { owner }),
          ...(state.reason === undefined ? {} : { reason: state.reason }),
        }
      }
      return statusAnswer({
        manifest: runtime.manifest,
        version: runtime.version,
        hostVersion: runtime.hostVersion,
        accounts: accountStatuses(runtime.accounts, signals),
        problems: runtime.accountProblems,
        unguardedAgents: await call.unguardedAgents(),
      })
    },
  }
}
