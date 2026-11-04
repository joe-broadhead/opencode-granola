import type { Plugin } from "@opencode/plugin"
import { STATUS_UNAVAILABLE, describe } from "../errors.js"
import type { StatusSource } from "../status.js"
import { Granola } from "./contract.js"

/**
 * Serves the shared status model to the TUI and other clients. It never calls Granola. A failed read is the RPC
 * error `unavailable`, with STATUS_UNAVAILABLE's code and next step, never the host's own error text.
 */
export async function registerRpc(ctx: { readonly rpc: Pick<Plugin.Context["rpc"], "register"> }, status: StatusSource): Promise<void> {
  await ctx.rpc.register(Granola, {
    status: async (_input, context) => {
      try {
        return await status.read()
      } catch {
        return context.error("unavailable", describe(STATUS_UNAVAILABLE), { code: STATUS_UNAVAILABLE.code, next: STATUS_UNAVAILABLE.next })
      }
    },
  })
}
