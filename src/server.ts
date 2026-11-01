import type { Plugin } from "@opencode/plugin"
import { SERVER } from "./known-tools.js"

type MCPEditor = Parameters<Parameters<Plugin.Context["mcp"]["transform"]>[0]>[0]

/** Granola's official remote MCP server. OpenCode owns the transport and the OAuth sign-in. */
export const OFFICIAL_URL = "https://mcp.granola.ai/mcp"

export interface Server {
  /** Why the plugin left the user's configuration alone, if it did. */
  conflict(): string | undefined
}

/**
 * Registers the official server unless the user already configured one under the same name. An entry with
 * another URL or transport is never overwritten; the returned conflict is reported by status instead.
 */
function applyServer(editor: Pick<MCPEditor, "get" | "set">): string | undefined {
  const existing = editor.get(SERVER)
  if (!existing) {
    editor.set(SERVER, { type: "remote", url: OFFICIAL_URL })
    return undefined
  }
  if (existing.type === "remote" && existing.url === OFFICIAL_URL) return undefined
  return "your OpenCode config defines mcp.servers.granola for a different server, so the plugin left it unchanged"
}

export async function registerServer(ctx: { readonly mcp: Pick<Plugin.Context["mcp"], "transform"> }): Promise<Server> {
  let conflict: string | undefined
  await ctx.mcp.transform((editor) => {
    conflict = applyServer(editor)
  })
  return { conflict: () => conflict }
}
