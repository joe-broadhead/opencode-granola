/**
 * The export's reader: notes and transcript pages for one meeting, through the same Granola tools as every other read.
 *
 * The provider names the alias's server, asserts nothing itself (the register does that once for the method), and maps
 * a vendor failure to the contract's form. This module only pages, bounds and labels what the export writes.
 */
import { SourceError } from "@we-the-rebel-alliance/plugin-contract/events"
import { oneLine, readNotes, type Notes, type Transcript, type TranscriptEnd } from "../export/render.ts"
import { readFailed } from "../export/errors.ts"
import type { Read } from "./client.ts"

export interface Limits {
  /** The whole file, in UTF-8 bytes. */
  readonly maxBytes: number
  /** Transcript pages read per meeting before giving up on the rest. */
  readonly maxPages: number
  /** Characters asked for per transcript page; Granola caps it at 80000. */
  readonly pageChars: number
}

const TRANSCRIPT_TOOL = "get_meeting_transcript"

/** Granola's answer when the user's plan does not include transcripts, such as "only available to paid tiers". */
const PLAN_REFUSAL = /\btranscripts?\b[^.]*\bpaid\b/i

/** The transcript end reason when the user's Granola plan does not include transcripts. */
export const NOT_ON_PLAN = "not_on_plan"

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

function text(result: { readonly output?: unknown; readonly content?: unknown }): string {
  if (typeof result.output === "string") return result.output
  if (typeof result.content === "string") return result.content
  return (Array.isArray(result.content) ? result.content : []).flatMap((part) => (record(part) && part.type === "text" && typeof part.text === "string" ? [part.text] : [])).join("\n")
}

/** Structured output, or text that holds a JSON object. */
function structured(result: { readonly output?: unknown; readonly content?: unknown }): Record<string, unknown> | undefined {
  if (record(result.output)) return result.output
  const body = text(result).trim()
  if (!body.startsWith("{")) return undefined
  try {
    const value: unknown = JSON.parse(body)
    return record(value) ? value : undefined
  } catch {
    return undefined
  }
}

interface Page {
  readonly text: string | null
  readonly unavailable?: string
  readonly next?: number
  readonly endsMidUtterance: boolean
  readonly title?: string
}

/** One get_meeting_transcript response. Text that is not a JSON object is taken as the whole transcript. */
function readPage(result: { readonly output?: unknown; readonly content?: unknown }): Page {
  const value = structured(result)
  if (!value || !("transcript" in value)) return { text: text(result), endsMidUtterance: false }
  const transcript = typeof value.transcript === "string" ? value.transcript : null
  const unavailable = record(value.transcript_unavailable) ? value.transcript_unavailable.reason : value.transcript_unavailable
  const next = value.truncated === true && Number.isSafeInteger(value.next_offset) ? (value.next_offset as number) : undefined
  return {
    text: transcript,
    ...(transcript === null ? { unavailable: typeof unavailable === "string" ? unavailable : "no reason given" } : {}),
    ...(next !== undefined ? { next } : {}),
    endsMidUtterance: value.ends_mid_utterance === true,
    ...(typeof value.title === "string" && value.title.trim() ? { title: oneLine(value.title) } : {}),
  }
}

interface Reader {
  notes(meetingID: string): Promise<Notes>
  /**
   * Pages through the transcript until it ends, stops advancing, reaches the page limit or uses up `budget` bytes.
   * With `unknown`, a meeting whose notes Granola did not find records a Granola failure as no meeting instead of
   * stopping the export.
   */
  transcript(meetingID: string, budget: number, unknown?: boolean): Promise<Transcript & { readonly bytes: number }>
  /** Whether Granola said, or showed by leaving out the tool, that the user's plan does not include transcripts. */
  transcriptsBlocked(): boolean
}

/** Rendered bytes of one transcript paragraph, including the blank line that separates it from the next. */
const paragraphBytes = (line: string) => Buffer.byteLength(line) + 2

/**
 * Checks that every tool the export will need is available before anything is written or asked, then pages through
 * Granola's answers. A missing transcript tool means the plan does not include transcripts; a missing notes tool is
 * UNAVAILABLE.
 */
export async function connect(read: Read, has: (tool: string) => Promise<boolean>, names: readonly string[], signal: AbortSignal, limits: Limits): Promise<Reader> {
  let blocked = false
  for (const name of names) {
    if (await has(name)) continue
    if (name === TRANSCRIPT_TOOL) blocked = true
    else {
      throw new SourceError({
        code: "UNAVAILABLE",
        what: `Granola does not offer ${name} for this account`,
        next: "The Granola plan may not include it; check the plugin's status or the account's Granola plan.",
      })
    }
  }

  async function call(name: string, input: Record<string, unknown>): Promise<{ readonly output?: unknown; readonly content?: unknown }> {
    signal.throwIfAborted()
    return read(name, input)
  }

  async function pages(meetingID: string, budget: number): Promise<Transcript & { readonly bytes: number }> {
    const lines: string[] = []
    let bytes = 0
    let title: string | undefined
    let offset = 0
    let joinNext = false
    const finish = (end: TranscriptEnd) => ({ lines, end, bytes, ...(title ? { title } : {}) })
    for (let page = 0; page < limits.maxPages; page++) {
      const result = readPage(await call(TRANSCRIPT_TOOL, { meeting_id: meetingID, offset, max_chars: limits.pageChars }))
      title ??= result.title
      if (result.text === null) return finish(lines.length ? { kind: "incomplete" } : { kind: "unavailable", reason: result.unavailable! })
      const incoming = result.text.split(/\r?\n/)
      if (joinNext && lines.length) {
        const last = lines.pop()!
        bytes -= paragraphBytes(last)
        incoming[0] = last + incoming[0]
      }
      for (const line of incoming) {
        if (!line.trim()) continue
        if (bytes + paragraphBytes(line) > budget) return finish({ kind: "size-limit" })
        lines.push(line)
        bytes += paragraphBytes(line)
      }
      if (result.next === undefined) return finish({ kind: "complete" })
      if (result.next <= offset) return finish({ kind: "incomplete" })
      offset = result.next
      joinNext = result.endsMidUtterance
    }
    return finish({ kind: "incomplete" })
  }

  const notOnPlan = { lines: [], end: { kind: "unavailable" as const, reason: NOT_ON_PLAN }, bytes: 0 }

  return {
    async notes(meetingID) {
      try {
        return readNotes((await call("get_meetings", { meeting_ids: [meetingID] })).output)
      } catch (error) {
        throw error instanceof SourceError ? readFailed("notes", meetingID, error.what) : error
      }
    },

    async transcript(meetingID, budget, unknown = false) {
      if (blocked) return notOnPlan
      try {
        return await pages(meetingID, budget)
      } catch (error) {
        if (!(error instanceof SourceError)) throw error
        if (PLAN_REFUSAL.test(error.what)) {
          blocked = true
          return notOnPlan
        }
        if (unknown) return { lines: [], end: { kind: "unavailable", reason: "meeting_not_found" }, bytes: 0 }
        throw readFailed("transcript", meetingID, error.what)
      }
    },

    transcriptsBlocked: () => blocked,
  }
}
