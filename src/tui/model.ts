import { statusRows, type Status, type StatusRow } from "../rpc/contract.js"

export type { Tone } from "../rpc/contract.js"

/** The plugin's status as fetched over RPC. Unavailable when the server part is not loaded or failed. */
export type Details =
  | { readonly type: "loading" }
  | { readonly type: "ready"; readonly status: Status }
  | { readonly type: "unavailable"; readonly reason: string; readonly next?: string }

export interface View {
  /** The same rows as /granola-status, in order. */
  readonly rows: readonly StatusRow[]
  readonly next: string
}

export const SERVER = "granola"
export const STATUS_SLASH = "granola"

/** The dialog's content, from the same status model that /granola-status prints. */
export function view(details: Details): View {
  if (details.type === "loading") {
    return { rows: [{ label: "Connection", text: "checking", tone: "info" }], next: "Wait a moment." }
  }
  if (details.type === "unavailable") {
    return {
      rows: [{ label: "Connection", text: `unknown: ${details.reason}`, tone: "warning" }],
      next: details.next ?? "Check that granola.meetings is active in /plugins, then press r to refresh.",
    }
  }
  return { rows: statusRows(details.status), next: details.status.nextStep }
}
