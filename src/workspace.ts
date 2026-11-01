const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null

function parse(value: unknown): unknown {
  if (typeof value !== "string") return value
  try { return JSON.parse(value) } catch { return undefined }
}

function text(content: unknown): string | undefined {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return undefined
  return content.flatMap((part) => record(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : []).join("\n")
}

/**
 * The active workspace's display name from a get_account_info result, which Granola returns as JSON with
 * `active_workspace.display_name`. Nothing else is read: no email, IDs or scopes.
 */
export function workspaceName(result: { readonly output?: unknown; readonly content?: unknown }): string | undefined {
  for (const candidate of [parse(result.output), parse(text(result.content))]) {
    const workspace = record(candidate) ? candidate.active_workspace : undefined
    const name = record(workspace) ? workspace.display_name : undefined
    if (typeof name !== "string") continue
    const clean = name.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim()
    if (clean) return clean.length > 80 ? `${clean.slice(0, 77)}...` : clean
  }
  return undefined
}
