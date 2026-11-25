/**
 * The meetings domain: events_list and its list snapshot, over the tools `provider/` already reaches.
 *
 * `search_meetings` filters by `from_date` and `to_date` and lists newest first, paging with `<pagination
 * next_cursor>`; `get_meetings` takes at most ten IDs, names the signed-in account and explains a miss in
 * `<not_found_hint>`. Every answer is untrusted text; this module reads it and never follows it.
 */
import {
  EVENT_LIMITS,
  type EventsGap,
  type EventsListResult,
  type SourceEvent,
  eventsListResult,
  fitPage,
  makeEvent,
  parseEventsListInput,
  screenEvents,
  secretKinds,
  startTime,
} from "@we-the-rebel-alliance/plugin-contract/events"
import type { Owner } from "@we-the-rebel-alliance/plugin-contract/manifest"
import { decodeBoundCursor, encodeBoundCursor } from "@we-the-rebel-alliance/plugin-contract/cursor"
import { SourceError } from "@we-the-rebel-alliance/plugin-contract/events"
import {
  accountUnnamed,
  cursorInvalid,
  sourceUnknown,
} from "./errors.ts"
import { connectedEmails, readMeetings, readMeetingsPage, resultText, type MeetingFacts } from "./granola.ts"
import type { Read } from "./client.ts"

/** The plugin's package name, which every page names. */
export const PACKAGE = "@we-the-rebel-alliance/granola-plugin"
/** The source every event names, and the `source` input the manifest gives. */
export const SOURCE = "granola"
/** The most bytes of JSON one page holds: the source's `maxBytes`. */
export const MAX_BYTES = 65_536

const DAY_MS = 86_400_000
/** What Granola's free (Basic) plan lets MCP see: the last 30 days. */
export const FREE_WINDOW_MS = 30 * DAY_MS
/**
 * How far back a listing on the free plan, or with no plan recorded, reads: a day inside the free window, so a meeting
 * at its edge is never skipped silently. Anything older is answered as a gap.
 */
export const VISIBLE_MS = FREE_WINDOW_MS - DAY_MS
/** The plans get_account_info names that have no window: Granola's paid plans. */
export const UNWINDOWED_PLANS: ReadonlySet<string> = new Set(["plus", "business", "enterprise"])
/** How long a recorded plan holds: a downgrade inside the day is the one case still answered without a gap. */
export const PLAN_TTL_MS = DAY_MS
/** A meeting is listed once it started this long ago. */
export const SETTLE_MS = 2 * 3_600_000
/** One search_meetings window. */
const WINDOW_MS = 7 * 86_400_000
/** The most windows one call reads; the cursor carries on from the last. */
const MAX_WINDOWS = 60
/** Meetings per search_meetings page: Granola's cap. */
const SEARCH_LIMIT = 100
/** The most search_meetings pages one window takes. */
const SEARCH_PAGES = 20
/** get_meetings takes at most 10 IDs. */
const DETAIL_BATCH = 10
/** Attendees per meeting Granola lists; an event keeps 20. */
const MAX_PARTICIPANTS = 20

/** The email in a `mailto:` owner id, lowercase. */
export function ownerEmail(owner: Owner): string {
  return owner.id.replace(/^mailto:/i, "").toLowerCase()
}

/** (start, id): the order events are listed in, and the cursor's position. */
interface Key {
  readonly t: number
  readonly i: string
}

const compare = (a: Key, b: Key) => a.t - b.t || (a.i < b.i ? -1 : a.i > b.i ? 1 : 0)

type Dated = MeetingFacts & { readonly time: number }

/** What a cursor is bound to: this plugin, its one source and the account alias. */
const bindingOf = (alias: string) => ({ plugin: "granola", source: SOURCE, account: alias })

/** A position, and the gap line of the read it continues, when that read answered a free-plan gap. */
interface Position extends Key {
  readonly w?: number
}

/**
 * The position a cursor holds for `alias`. Another account's cursor, or any malformed cursor, is CURSOR_INVALID; the
 * caller starts again with since.
 */
function positionOf(cursor: string, alias: string): Position {
  const decoded = decodeBoundCursor(bindingOf(alias), cursor)
  if (!decoded.ok) throw cursorInvalid()
  const { state } = decoded
  const t = state["t"]
  const i = state["i"]
  if (typeof t !== "number" || !Number.isSafeInteger(t) || typeof i !== "string" || i.length > EVENT_LIMITS.externalId) throw cursorInvalid()
  const w = state["w"]
  if (w !== undefined && (typeof w !== "number" || !Number.isSafeInteger(w))) throw cursorInvalid()
  return w === undefined ? { t, i } : { t, i, w }
}

/** Seconds are as fine as Granola's date filters need; the window is widened to whole seconds. */
const isoFloor = (time: number) => new Date(Math.floor(time / 1000) * 1000).toISOString()
const isoCeil = (time: number) => new Date(Math.ceil(time / 1000) * 1000).toISOString()

/** One listing's reads: the reader, the alias it reads, what get_meetings has given so far, and whether it named the account. */
interface Listing {
  readonly read: Read
  readonly alias: string
  readonly email: string
  readonly details: Map<string, MeetingFacts>
  readonly tried: Set<string>
  verified: boolean
}

/**
 * get_meetings for a batch. An answer that names another signed-in account than the listing's is ACCOUNT_MISMATCH; one
 * that holds meetings and names no account is UNAVAILABLE, since they cannot be told to be the account's. An answer
 * with no meeting labels nothing, so it needs no name.
 */
async function getMeetings(listing: Listing, ids: readonly string[]): Promise<MeetingFacts[]> {
  const text = resultText(await listing.read("get_meetings", { meeting_ids: ids, max_participants: MAX_PARTICIPANTS, attachments: "none" }))
  const named = connectedEmails(text)
  if (named.some((email) => email !== listing.email)) {
    throw new SourceError({
      code: "ACCOUNT_MISMATCH",
      what: `${listing.alias} reads ${listing.email}, and Granola answered as ${named.join(", ")}`,
      next: `Sign ${listing.alias} out and in again with the account it should use, then retry.`,
    })
  }
  const meetings = readMeetings(text)
  if (named.length === 0 && meetings.length > 0) throw accountUnnamed(listing.alias)
  if (named.length > 0) listing.verified = true
  return meetings
}

/** Meetings by ID from get_meetings, into the listing's details. An ID Granola leaves out of a batch is asked for once more alone. */
async function readDetails(listing: Listing, ids: readonly string[]): Promise<void> {
  const { details, tried } = listing
  const wanted = ids.filter((id) => !details.has(id) && !tried.has(id))
  for (let start = 0; start < wanted.length; start += DETAIL_BATCH) {
    const batch = wanted.slice(start, start + DETAIL_BATCH)
    for (const id of batch) tried.add(id)
    for (const meeting of await getMeetings(listing, batch)) if (batch.includes(meeting.id)) details.set(meeting.id, meeting)
    if (batch.length > 1) {
      for (const id of batch.filter((id) => !details.has(id))) {
        const meeting = (await getMeetings(listing, [id])).find((entry) => entry.id === id)
        if (meeting) details.set(id, meeting)
      }
    }
  }
}

/** What search_meetings and get_meetings know of a meeting, get_meetings first. */
function merged(listed: MeetingFacts, detail: MeetingFacts | undefined): MeetingFacts {
  if (!detail) return listed
  const title = detail.title ?? listed.title
  const time = detail.time ?? listed.time
  const url = detail.url ?? listed.url
  const summary = detail.summary ?? listed.summary
  return {
    id: listed.id,
    ...(title === undefined ? {} : { title }),
    ...(time === undefined ? {} : { time }),
    ...(url === undefined ? {} : { url }),
    participants: detail.participants.length > 0 ? detail.participants : listed.participants,
    ...(summary === undefined ? {} : { summary }),
  }
}

/** Every meeting of one window, dated: from search_meetings, with get_meetings for a start search did not give as an ISO time. */
async function searchWindow(listing: Listing, from: number, to: number): Promise<Dated[]> {
  const filters = { from_date: isoFloor(from), to_date: isoCeil(to), attended_only: true, limit: SEARCH_LIMIT, max_participants: MAX_PARTICIPANTS }
  const listed: MeetingFacts[] = []
  let cursor: string | undefined
  for (let page = 0; ; page++) {
    if (page >= SEARCH_PAGES) {
      throw new SourceError({
        code: "UNAVAILABLE",
        what: `Granola listed more than ${SEARCH_PAGES * SEARCH_LIMIT} meetings in one week`,
        next: "Read a narrower window, or try again later.",
      })
    }
    const result = readMeetingsPage(resultText(await listing.read("search_meetings", { ...filters, ...(cursor === undefined ? {} : { cursor }) })))
    listed.push(...result.meetings)
    if (result.incomplete) {
      throw new SourceError({ code: "UNAVAILABLE", what: "Granola could not list every meeting of one week", next: "Try again later." })
    }
    if (result.next === undefined || result.next === cursor) break
    cursor = result.next
  }
  await readDetails(listing, listed.filter((meeting) => meeting.time === undefined).map((meeting) => meeting.id))
  // A meeting Granola gives no start for at all cannot be placed in time, so it is left out.
  return listed.map((meeting) => merged(meeting, listing.details.get(meeting.id))).filter((meeting): meeting is Dated => meeting.time !== undefined)
}

/** `name:` and the name, for an attendee without an email; the id has no spaces. */
const nameID = (name: string) => `name:${encodeURIComponent(name.trim().replace(/\s+/g, " "))}`

function toEvent(alias: string, meeting: Dated): SourceEvent {
  return makeEvent({
    source: SOURCE,
    account: alias,
    external_id: meeting.id,
    kind: "meeting",
    occurred_at: meeting.time,
    thread: null,
    actors: meeting.participants.map((participant) => ({
      role: participant.creator ? "creator" : "attendee",
      id: participant.email ? `mailto:${participant.email}` : nameID(participant.name!),
      ...(participant.name ? { name: participant.name } : {}),
    })),
    title: meeting.title ?? "",
    text: meeting.summary ?? "",
    url: meeting.url ?? null,
    labels: [],
  })
}

export interface ListOptions {
  /** The resolved account alias. */
  readonly alias: string
  readonly owner: Owner
  /** The clock, in epoch milliseconds. */
  readonly now: number
  /** The plan a probe recorded for the alias, or undefined. */
  readonly plan: string | undefined
}

/**
 * One page of events for one alias. `read` runs Granola's tools as the caller; every input and cursor is checked before
 * any read. The page's account is the alias, and its owner is the address the alias is signed in as.
 */
export async function listEvents(read: Read, input: unknown, options: ListOptions): Promise<EventsListResult> {
  const parsed = parseEventsListInput(input)
  if (!parsed.ok) {
    throw new SourceError({ code: "INPUT_INVALID", what: parsed.problems.join("; "), next: "Pass only the input the method's schema describes." })
  }
  const request = parsed.value
  if (request.source !== undefined && request.source !== SOURCE) throw sourceUnknown(SOURCE)
  const { alias, owner, now } = options
  const email = ownerEmail(owner)
  const start: Position = request.cursor !== undefined ? positionOf(request.cursor, alias) : { t: startTime(request, now), i: "" }
  let after: Key = { t: start.t, i: start.i }
  const end = now - SETTLE_MS
  // On the free plan, or with no plan recorded, history before the window is out of reach: the page answers that once,
  // and the read restarts at the gap line. A cursor of a read that already answered its gap is held to Granola's whole
  // 30 days instead, so the gap line moving with the clock never makes a later page repeat the gap or skip a meeting
  // Granola still shows; only a cursor that has fallen out of the 30 days answers a new one.
  const windowed = options.plan === undefined || !UNWINDOWED_PLANS.has(options.plan)
  const continuing = start.w !== undefined && start.t < start.w + DAY_MS
  let line: number | undefined = windowed && continuing ? start.w : undefined
  let gap: EventsGap | undefined
  if (windowed && after.t < now - (continuing ? FREE_WINDOW_MS : VISIBLE_MS)) {
    gap = { reason: "window-truncated", since: new Date(after.t).toISOString() }
    line = now - VISIBLE_MS
    after = { t: line, i: "" }
  }

  const listing: Listing = { read, alias, email, details: new Map(), tried: new Set(), verified: false }
  const found = new Map<string, Dated>()
  let scanned = after.t
  for (let from = after.t, windows = 0; from <= end && windows < MAX_WINDOWS && found.size <= request.limit; windows++) {
    const to = Math.min(from + WINDOW_MS, end)
    for (const meeting of await searchWindow(listing, from, to)) {
      if (meeting.time <= end && compare({ t: meeting.time, i: meeting.id }, after) > 0) found.set(meeting.id, meeting)
    }
    scanned = to
    if (to >= end) break
    from = to
  }

  const ordered = [...found.values()].sort((a, b) => compare({ t: a.time, i: a.id }, { t: b.time, i: b.id }))
  const chosen = ordered.slice(0, request.limit)
  await readDetails(listing, chosen.map((meeting) => meeting.id))
  // Every chosen meeting went to get_meetings; a page lists nothing unless an answer named the listing's account.
  if (chosen.length > 0 && !listing.verified) throw accountUnnamed(alias)
  const all = chosen.map((meeting) => toEvent(alias, { ...merged(meeting, listing.details.get(meeting.id)), time: meeting.time }))
  // A meeting whose title or summary holds a secret is refused for good; the rest fill the page up to its size.
  const screened = screenEvents(all)
  const fits = fitPage(screened.events, request.limit, MAX_BYTES)
  const page = screened.events.slice(0, fits)
  const index = new Map(chosen.map((meeting, position) => [meeting.id, position]))
  // The last meeting this page accounts for: every chosen one when the whole screened list fits, so a refused meeting
  // at the end is passed too; otherwise the last listed.
  const last = fits === screened.events.length ? chosen.length - 1 : index.get(page[fits - 1]!.external_id)!
  const refused = screened.refused.filter((entry) => index.get(entry.external_id)! <= last)
  const more = ordered.length > last + 1 || scanned < end
  const lastMeeting = chosen[last]
  const position: Key = lastMeeting ? { t: lastMeeting.time, i: lastMeeting.id } : scanned > after.t ? { t: scanned, i: "" } : after
  // The gap line rides on the cursor until the read is a day past it.
  const marked = line !== undefined && position.t < line + DAY_MS
  const cursor = encodeBoundCursor(bindingOf(alias), { t: position.t, i: position.i, ...(marked ? { w: line } : {}) })
  return eventsListResult({ source: SOURCE, account: alias, owner }, page, cursor, more, {
    refused,
    plugin: PACKAGE,
    asOf: new Date(now).toISOString(),
    ...(gap === undefined ? {} : { gap }),
  })
}

/** The list registry holds 50 items. A list read asks Granola for the recent window and returns no more. */
const LIST_CAP = 50
/** C0 and C1 control characters: JSON escapes each to six bytes, so a title holding many would blow `maxBytes`. */
const CONTROL = /\p{Cc}/gu

/** Meetings as the contract's `list` output: id and title. Not editable. A title that holds a secret is left out. */
export interface MeetingsList {
  readonly data: { readonly items: readonly { readonly id: string; readonly text: string }[]; readonly editable: false }
  readonly asOf: string
  readonly trust: "untrusted"
}

/**
 * The meetings list snapshot. It reads through the same `search_meetings` executor as `events_list`, not a second
 * client, over the window a free plan still shows, and returns titles only. When the search found a meeting it reads
 * `get_meetings` once for the first batch, as the events source does, so the answer names the signed-in account: another
 * account is ACCOUNT_MISMATCH, and an answer that holds meetings and names none is UNAVAILABLE. It never reads
 * `get_account_info`.
 */
export async function meetingsList(read: Read, alias: string, now: number, expectedEmail?: string): Promise<MeetingsList> {
  const filters = { from_date: isoFloor(now - VISIBLE_MS), to_date: isoCeil(now), attended_only: true, limit: SEARCH_LIMIT, max_participants: MAX_PARTICIPANTS }
  const found: MeetingFacts[] = []
  let cursor: string | undefined
  for (let page = 0; page < SEARCH_PAGES && found.length < LIST_CAP; page++) {
    const result = readMeetingsPage(resultText(await read("search_meetings", { ...filters, ...(cursor === undefined ? {} : { cursor }) })))
    if (result.incomplete) {
      throw new SourceError({ code: "UNAVAILABLE", what: "Granola could not list every meeting of the window", next: "Try again later." })
    }
    found.push(...result.meetings)
    if (result.next === undefined || result.next === cursor) break
    cursor = result.next
  }
  if (found.length > 0) {
    const first = [...new Set(found.map((meeting) => meeting.id))].slice(0, DETAIL_BATCH)
    const text = resultText(await read("get_meetings", { meeting_ids: first, max_participants: MAX_PARTICIPANTS, attachments: "none" }))
    const named = connectedEmails(text)
    if (named.length === 0) throw accountUnnamed(alias)
    if (expectedEmail !== undefined && named.some((email) => email !== expectedEmail)) {
      throw new SourceError({
        code: "ACCOUNT_MISMATCH",
        what: `${alias} reads ${expectedEmail}, and Granola answered as ${named.join(", ")}`,
        next: `Sign ${alias} out and in again with the account it should use, then retry.`,
      })
    }
  }
  // Newest first, independent of the order search_meetings answers in. A meeting whose search page gives no start keeps
  // its relative place, as the sort is stable.
  const ordered = [...found].sort((a, b) => (b.time ?? 0) - (a.time ?? 0))
  const items: { id: string; text: string }[] = []
  const seen = new Set<string>()
  for (const meeting of ordered) {
    if (items.length >= LIST_CAP) break
    const id = meeting.id.slice(0, 128)
    // The whole title is screened before the cut, so a secret that straddles 200 characters is still refused.
    const whole = (meeting.title ?? "").replace(/\s+/g, " ").replace(CONTROL, "").trim()
    if (id === "" || whole === "" || seen.has(id) || secretKinds(whole).length > 0) continue
    seen.add(id)
    items.push({ id, text: whole.slice(0, 200) })
  }
  const answer: MeetingsList = {
    data: { items, editable: false },
    asOf: new Date(now).toISOString(),
    trust: "untrusted",
  }
  // `maxBytes` holds with 50 maximal items: drop items from the end, the oldest, until the answer fits. The registry
  // holds at most 50, so a shortened list is still a list.
  while (items.length > 0 && new TextEncoder().encode(JSON.stringify(answer)).length > MAX_BYTES) items.pop()
  return answer
}
