/** The MCP server name. OpenCode names its tools granola_<tool> and asserts that name as the permission action. */
export const SERVER = "granola"

/**
 * Granola's tools, classified from the server's readOnlyHint and destructiveHint annotations at the last
 * reviewed release. A tool missing here is unknown: it stays available and asks before it runs.
 */
export const READ_TOOLS = [
  "get_account_info",
  "list_meeting_folders",
  "list_meetings",
  "search_meetings",
  "get_meetings",
  "get_meeting_transcript",
  "query_granola_meetings",
  "get_meeting_attachment",
  "list_templates",
  "search_transcripts",
] as const

/** Writes and sends. */
export const WRITE_TOOLS = [
  "create_folder",
  "update_folder",
  "add_note_to_folder",
  "remove_note_from_folder",
  "update_private_notes",
  "generate_summary",
  "give_feedback",
] as const

/** sign_out revokes the grant OpenCode holds; `opencode mcp logout granola` does that instead. */
export const HIDDEN_TOOLS = ["sign_out"] as const

/** Tools this plugin adds to the granola namespace itself. */
export const PLUGIN_TOOLS = ["export_markdown"] as const

export type ToolClass = "read" | "write" | "hidden" | "plugin" | "unknown"

export function toolID(name: string): string {
  return `${SERVER}_${name}`
}

/** Classifies a registered tool id such as granola_get_meetings; undefined for tools outside the namespace. */
export function classify(id: string): ToolClass | undefined {
  if (!id.startsWith(`${SERVER}_`)) return undefined
  const name = id.slice(SERVER.length + 1)
  const has = (list: readonly string[]) => list.includes(name)
  if (has(READ_TOOLS)) return "read"
  if (has(WRITE_TOOLS)) return "write"
  if (has(HIDDEN_TOOLS)) return "hidden"
  if (has(PLUGIN_TOOLS)) return "plugin"
  return "unknown"
}
