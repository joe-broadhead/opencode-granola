import type { Plugin } from "@opencode/plugin"
import { STATUS_UNAVAILABLE, describe } from "./errors.js"
import { formatStatus, type StatusSource } from "./status.js"

export const STATUS_COMMAND = "granola-status"

export interface CommandsContext {
  readonly command: Pick<Plugin.Context["command"], "transform">
  readonly session: Pick<Plugin.Context["session"], "synthetic">
}

export async function registerCommands(ctx: CommandsContext, status: StatusSource): Promise<void> {
  await ctx.command.transform((editor) => {
    editor.add({
      name: STATUS_COMMAND,
      description: "Granola: connection, workspace and next step",
      execute: async ({ sessionID, delivery }) => {
        let text: string
        try { text = formatStatus(await status.read()) } catch { text = describe(STATUS_UNAVAILABLE) }
        // Synthetic delivery with resume: false posts a notice without starting a model turn.
        await ctx.session.synthetic({ sessionID, delivery, text, description: "Granola status", resume: false })
      },
    })
  })
}
