/**
 * What the plugin reads from Granola's text and JSON answers.
 *
 * `search_meetings` and `get_meetings` answer in XML-like text, so only this module knows its element and attribute
 * names:
 *
 * - `search_meetings`: `<meetings_data …>`, one `<meeting id=… title=… …>` per meeting, newest first, and at the end
 *   `<pagination has_more=… completion_status=… next_cursor=… />`;
 * - `get_meetings`: a `<connected_user_email>` preamble, then `<meetings_data>` with each `<meeting id title
 *   meeting_at url>`, its `<known_participants>` (`<participant name email />`) and its `<summary>`;
 * - `get_account_info`: a JSON object with the signed-in `email`, `mcp_note_access.scopes`, what the connection can
 *   search (`personal`, `public`), and `mcp_plan`, "the effective plan for MCP access and limits".
 *
 * Every reader tolerates a missing optional part, and returns nothing rather than guess.
 */
import { findAll, isMarkup, parse, textContent, type Element } from "../export/markup.ts"

/** One meeting as Granola lists or reads it. */
export interface MeetingFacts {
  readonly id: string
  readonly title?: string
  /** Epoch milliseconds: the calendar event's start, or the note's creation without one. */
  readonly time?: number
  readonly url?: string
  readonly participants: readonly Participant[]
  /** Granola's AI summary, as text. */
  readonly summary?: string
}

export interface Participant {
  readonly name?: string
  readonly email?: string
  readonly creator: boolean
}

/** A search_meetings page: its meetings, and the cursor of the next page when Granola has one. */
export interface MeetingsPage {
  readonly meetings: readonly MeetingFacts[]
  readonly next?: string
  /** Granola said the listing cannot continue (`completion_status="incomplete"`). */
  readonly incomplete: boolean
}

/** An email, as Granola names the signed-in account. */
const EMAIL = /^[^\s@]+@[^\s@]+$/

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** The text of a tool result, or its output when that is already text. */
export function resultText(result: { readonly output?: unknown; readonly content?: unknown }): string {
  if (typeof result.output === "string") return result.output
  if (typeof result.content === "string") return result.content
  if (Array.isArray(result.content)) {
    return result.content.flatMap((part) => (record(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : [])).join("\n")
  }
  return ""
}

/** A time attribute Granola wrote as an ISO date-time with a zone; undefined for anything else, such as "Oct 30, 2026". */
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/
const TIME_ATTRIBUTES = ["meeting_at", "start_time", "started_at", "start", "created_at", "date"] as const

function timeOf(attributes: Readonly<Record<string, string>>): number | undefined {
  for (const name of TIME_ATTRIBUTES) {
    const value = attributes[name]?.trim()
    if (!value || !ISO_WITH_ZONE.test(value)) continue
    const time = Date.parse(value)
    if (Number.isFinite(time)) return time
  }
  return undefined
}

const nonEmpty = (value: string | undefined) => (value !== undefined && value.trim() !== "" ? value.trim() : undefined)

function participants(meeting: Element): Participant[] {
  return findAll(meeting, "participant").flatMap((element) => {
    const name = nonEmpty(element.attributes.name)
    const email = nonEmpty(element.attributes.email)?.toLowerCase()
    if (!name && !email) return []
    const role = `${element.attributes.role ?? ""} ${element.attributes.type ?? ""}`.toLowerCase()
    const creator = /\b(creator|owner|organi[sz]er)\b/.test(role) || element.attributes.is_creator === "true" || element.attributes.creator === "true"
    return [{ ...(name ? { name } : {}), ...(email ? { email } : {}), creator }]
  })
}

function meetingFacts(meeting: Element): MeetingFacts | undefined {
  const id = nonEmpty(meeting.attributes.id)
  if (!id) return undefined
  const title = nonEmpty(meeting.attributes.title)
  const time = timeOf(meeting.attributes)
  const url = nonEmpty(meeting.attributes.url) ?? nonEmpty(meeting.attributes.note_url)
  const summary = findAll(meeting, "summary").map((element) => textContent(element).trim()).filter(Boolean).join("\n\n")
  return {
    id,
    ...(title ? { title } : {}),
    ...(time === undefined ? {} : { time }),
    ...(url ? { url } : {}),
    participants: participants(meeting),
    ...(summary ? { summary } : {}),
  }
}

/** Every `<meeting>` in the text, outside any preamble. */
export function readMeetings(text: string): MeetingFacts[] {
  if (!isMarkup(text)) return []
  return findAll(parse(text), "meeting").flatMap((meeting) => meetingFacts(meeting) ?? [])
}

/** A search_meetings page. The cursor is the `<pagination>` element's `next_cursor`, present while there is more. */
export function readMeetingsPage(text: string): MeetingsPage {
  const root = isMarkup(text) ? parse(text) : { name: "", attributes: {}, children: [] }
  const pagination = findAll(root, "pagination").at(-1)
  const next = nonEmpty(pagination?.attributes.next_cursor)
  const status = pagination?.attributes.completion_status?.trim().toLowerCase()
  return {
    meetings: findAll(root, "meeting").flatMap((meeting) => meetingFacts(meeting) ?? []),
    ...(next ? { next } : {}),
    incomplete: status === "incomplete",
  }
}

/** The signed-in account's email from get_account_info's JSON object, or from a `<connected_user_email>` element. */
export function accountEmail(result: { readonly output?: unknown; readonly content?: unknown }): string | undefined {
  const candidates: unknown[] = [result.output]
  const text = resultText(result).trim()
  if (text.startsWith("{")) {
    try {
      candidates.push(JSON.parse(text))
    } catch {
      // Not JSON: the markup below may still name it.
    }
  }
  for (const value of candidates) {
    if (!record(value)) continue
    const nested = [value, value.user, value.account].find((entry) => record(entry) && typeof entry.email === "string") as Record<string, unknown> | undefined
    const email = nested && typeof nested.email === "string" ? nested.email.trim().toLowerCase() : undefined
    if (email && EMAIL.test(email)) return email
  }
  if (isMarkup(text)) {
    const root = parse(text)
    const element = findAll(root, "connected_user_email")[0]
    const attribute = findAll(root, "meetings_data").map((data) => data.attributes.connected_user_email).find(Boolean)
    const email = (element ? textContent(element) : attribute)?.trim().toLowerCase()
    if (email && EMAIL.test(email)) return email
  }
  return undefined
}

/**
 * Every signed-in account a get_meetings answer names, lowercase, in either form Granola writes it: a
 * `<connected_user_email>` element, or a `connected_user_email` attribute of `<meetings_data>`. Empty when it names none.
 */
export function connectedEmails(text: string): string[] {
  if (!isMarkup(text)) return []
  const root = parse(text)
  const named = [
    ...findAll(root, "connected_user_email").map((element) => textContent(element)),
    ...findAll(root, "meetings_data").flatMap((data) => (data.attributes.connected_user_email === undefined ? [] : [data.attributes.connected_user_email])),
  ]
  return [...new Set(named.map((email) => email.trim().toLowerCase()).filter((email) => EMAIL.test(email)))]
}

/** The note-access scopes get_account_info names (`mcp_note_access.scopes`), at most 64 of at most 256 characters. */
export function accountScopes(result: { readonly output?: unknown; readonly content?: unknown }): string[] | undefined {
  const candidates: unknown[] = [result.output]
  const text = resultText(result).trim()
  if (text.startsWith("{")) {
    try {
      candidates.push(JSON.parse(text))
    } catch {
      // Not JSON: no scopes.
    }
  }
  for (const value of candidates) {
    const access = record(value) ? value.mcp_note_access : undefined
    const scopes = record(access) ? access.scopes : undefined
    if (!Array.isArray(scopes)) continue
    const named = scopes.filter((scope): scope is string => typeof scope === "string" && scope.trim() !== "" && scope.length <= 256).map((scope) => scope.trim())
    return [...new Set(named)].slice(0, 64)
  }
  return undefined
}

/**
 * The plan get_account_info names (`mcp_plan`, "the effective plan for MCP access and limits"), trimmed and lowercase,
 * at most 64 characters: a string, or an object's `name`, `id` or `plan`. Undefined when it names none.
 */
export function accountPlan(result: { readonly output?: unknown; readonly content?: unknown }): string | undefined {
  const candidates: unknown[] = [result.output]
  const text = resultText(result).trim()
  if (text.startsWith("{")) {
    try {
      candidates.push(JSON.parse(text))
    } catch {
      // Not JSON: no plan.
    }
  }
  for (const value of candidates) {
    const plan = record(value) ? value.mcp_plan : undefined
    const named = typeof plan === "string" ? plan : record(plan) ? [plan.name, plan.id, plan.plan].find((entry) => typeof entry === "string") : undefined
    const clean = typeof named === "string" ? named.trim().toLowerCase() : ""
    if (clean !== "" && clean.length <= 64) return clean
  }
  return undefined
}
