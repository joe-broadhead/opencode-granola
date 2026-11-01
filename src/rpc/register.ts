import type { Plugin } from "@opencode/plugin"
import type { StatusSource } from "../status.js"
import { Granola } from "./contract.js"

/** Serves the shared status model to the TUI and other clients. It never calls Granola. */
export async function registerRpc(ctx: { readonly rpc: Pick<Plugin.Context["rpc"], "register"> }, status: StatusSource): Promise<void> {
  await ctx.rpc.register(Granola, { status: () => status.read() })
}
