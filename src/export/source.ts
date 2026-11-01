import type { Plugin } from "@opencode/plugin"
import { Error as ToolError, type ToolContext } from "@opencode/plugin/promise/tool"
import { connectionProblem, toolError, toolUnavailable } from "../errors.js"
import { SERVER, toolID } from "../known-tools.js"
import { unavailableProblem } from "../tools.js"
import { exportError, readFailed } from "./errors.js"
import { oneLine, readNotes, type Notes, type Transcript, type TranscriptEnd } from "./render.js"

export interface SourceContext {
  readonly tool: Pick<Plugin.Context["tool"], "list">
  readonly mcp: Pick<Plugin.Context["mcp"], "list">
}

type Tool = Awaited<ReturnType<Plugin.Context["tool"]["list"]>>[number]
type Result = Awaited<ReturnType<Tool["execute"]>>

export interface Limits {
  /** The whole file, in UTF-8 bytes. */
  readonly maxBytes: number
  /** Transcript pages read per meeting before giving up on the rest. */
  readonly maxPages: number
  /** Characters asked for per transcript page; Granola caps it at 80000. */
  readonly pageChars: number
}

/** The host's fixed message when a Granola tool runs while the server is unavailable starts with this. */
const UNAVAILABLE = `MCP server "${SERVER}" `

const TRANSCRIPT_TOOL = "get_meeting_transcript"

/** Granola's answer when the user's plan does not include transcripts, such as "only available to paid tiers". */
const PLAN_REFUSAL = /\btranscripts?\b[^.]*\bpaid\b/i

/** The transcript end reason when the user's Granola plan does not include transcripts. */
export const NOT_ON_PLAN = "not_on_plan"

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * The tool's executor from OpenCode's registry. A missing tool means Granola is not connected, which throws, or is
 * connected but the user's plan does not include the tool, which returns undefined.
 */
async function executor(ctx: SourceContext, name: string): Promise<Tool | undefined> {
  const tool = (await ctx.tool.list()).find((entry) => entry.id === toolID(name))
  if (tool) return tool
  const state = (await ctx.mcp.list()).data.find((entry) => entry.name === SERVER)?.status
  const problem = connectionProblem(state?.status ?? "absent", state && "error" in state ? state.error : undefined)
  if (problem) throw toolError(problem)
  return undefined
}

function text(result: Result): string {
  if (typeof result.output === "string") return result.output
  if (typeof result.content === "string") return result.content
  return (result.content ?? []).flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n")
}

/** Structured output, or text that holds a JSON object. */
function structured(result: Result): Record<string, unknown> | undefined {
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
function readPage(result: Result): Page {
  const value = structured(result)
  if (!value || !("transcript" in value)) return { text: text(result), endsMidUtterance: false }
  const transcript = typeof value.transcript === "string" ? value.transcript : null
  const unavailable = record(value.transcript_unavailable) ? value.transcript_unavailable.reason : value.transcript_unavailable
  const next = value.truncated === true && Number.isSafeInteger(value.next_offset) ? value.next_offset as number : undefined
  return {
    text: transcript,
    ...(transcript === null ? { unavailable: typeof unavailable === "string" ? unavailable : "no reason given" } : {}),
    ...(next !== undefined ? { next } : {}),
    endsMidUtterance: value.ends_mid_utterance === true,
    ...(typeof value.title === "string" && value.title.trim() ? { title: oneLine(value.title) } : {}),
  }
}

export interface Reader {
  notes(meetingID: string): Promise<Notes>
  /**
   * Pages through the transcript until it ends, stops advancing, reaches the page limit or uses up `budget`
   * bytes. With `unknown`, a meeting whose notes Granola did not find, a Granola failure is recorded as no
   * meeting instead of stopping the export.
   */
  transcript(meetingID: string, budget: number, unknown?: boolean): Promise<Transcript & { readonly bytes: number }>
  /** Whether Granola said, or showed by leaving out the tool, that the user's plan does not include transcripts. */
  transcriptsBlocked(): boolean
}

/** A Granola failure for one call, before it is named for the export. */
class GranolaFailure {
  constructor(readonly message: string) {}
}

/** Rendered bytes of one transcript paragraph, including the blank line that separates it from the next. */
const paragraphBytes = (line: string) => Buffer.byteLength(line) + 2

/**
 * Reads through OpenCode's own Granola tools, so each call is checked against the user's permissions for
 * that read under the export's session and agent. The executors bypass host hooks, so connection failures
 * are mapped here. Every tool in `names` is looked up before the export asks the user; get_meetings is also
 * looked up later when a transcript export falls back to the notes.
 */
export async function connect(ctx: SourceContext, names: readonly string[], context: ToolContext, limits: Limits): Promise<Reader> {
  const tools = new Map<string, Tool>()
  let blocked = false
  const lookup = async (name: string) => {
    const tool = await executor(ctx, name)
    if (tool) tools.set(name, tool)
    else if (name === TRANSCRIPT_TOOL) blocked = true
    else throw toolError(toolUnavailable(name))
  }
  for (const name of names) await lookup(name)

  async function call(name: string, input: Record<string, unknown>): Promise<Result> {
    context.signal.throwIfAborted()
    if (!tools.has(name)) await lookup(name)
    try {
      return await tools.get(name)!.execute(input, context)
    } catch (error) {
      if (error instanceof Error && error.message.startsWith(UNAVAILABLE)) throw toolError(await unavailableProblem(ctx))
      // Granola's own failures are a Tool.Error without a cause. Permission outcomes pass through unchanged:
      // a deny or a rejection with feedback carries its cause, and a plain rejection, which ends the step,
      // is not a Tool.Error.
      if (error instanceof ToolError && error.error === undefined) throw new GranolaFailure(error.message)
      throw error
    }
  }

  return {
    async notes(meetingID) {
      try {
        return readNotes((await call("get_meetings", { meeting_ids: [meetingID] })).output)
      } catch (error) {
        throw error instanceof GranolaFailure ? exportError(readFailed("notes", meetingID, error.message)) : error
      }
    },

    async transcript(meetingID, budget, unknown = false) {
      const notOnPlan = { lines: [], end: { kind: "unavailable" as const, reason: NOT_ON_PLAN }, bytes: 0 }
      if (blocked) return notOnPlan
      try {
        return await pages(meetingID, budget)
      } catch (error) {
        if (!(error instanceof GranolaFailure)) throw error
        if (PLAN_REFUSAL.test(error.message)) {
          blocked = true
          return notOnPlan
        }
        if (unknown) return { lines: [], end: { kind: "unavailable", reason: "meeting_not_found" }, bytes: 0 }
        throw exportError(readFailed("transcript", meetingID, error.message))
      }
    },

    transcriptsBlocked: () => blocked,
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
}
