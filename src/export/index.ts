import type { Plugin } from "@opencode/plugin"
import type { ToolContext } from "@opencode/plugin/promise/tool"
import { toolError } from "../errors.js"
import { SERVER, toolID } from "../known-tools.js"
import type { Options } from "../options.js"
import { MarkdownExportRefusal, writeMarkdownExport } from "../io/markdown-export.js"
import { exists, invalidInput, invalidPath, size, tooLarge, writeFailed } from "./errors.js"
import { defaultName, errorCode, exportPath, preflight, prepare } from "./paths.js"
import { renderDocument, type Content, type Meeting, type Notes, type Transcript, type TranscriptEnd } from "./render.js"
import { NOT_ON_PLAN, connect, type Limits, type SourceContext } from "./source.js"

const EXPORT_TOOL = "export_markdown"

export const EXPORT_DESCRIPTION =
  "Save Granola meeting notes, transcripts or both, for 1 to 20 meetings, to one readable Markdown file in the user's export folder. The text goes straight to the file instead of through the conversation. Unless the user's permissions already allow exports, OpenCode asks before the file is written. At most 8 MB; a transcript that does not fit is cut with a note. Without transcripts on the user's plan, the file holds the notes and says so. Returns the file's path, its size in bytes and its SHA-256 checksum; the text result also names anything missing."

const CONTENT = ["notes", "transcript", "both"] as const
const MAX_MEETINGS = 20

export const EXPORT_INPUT = {
  type: "object",
  additionalProperties: false,
  required: ["meeting_ids", "content"],
  properties: {
    meeting_ids: {
      type: "array",
      minItems: 1,
      maxItems: MAX_MEETINGS,
      items: { type: "string", minLength: 1, maxLength: 200 },
      description: "Granola meeting IDs or public note IDs, from Granola's meeting tools or note links. The file keeps this order.",
    },
    content: {
      type: "string",
      enum: CONTENT,
      description: "notes: the user's notes, Granola's AI summary and attendees; transcript: the verbatim transcript; both: notes, then transcript.",
    },
    path: {
      type: "string",
      minLength: 1,
      maxLength: 512,
      description: "File path relative to the export folder, such as `meetings/weekly-sync.md`. Missing folders are created and `.md` is added when absent. Default: a new file name with the date and time.",
    },
    overwrite: {
      type: "boolean",
      default: false,
      description: "Replace an existing file at path. Ask the user first.",
    },
  },
} as const

export const EXPORT_OUTPUT = {
  type: "object",
  additionalProperties: false,
  required: ["path", "bytes", "sha256"],
  properties: {
    path: { type: "string", description: "Absolute path of the written file." },
    bytes: { type: "integer", minimum: 0 },
    sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
  },
} as const

export interface ExportResult {
  readonly path: string
  readonly bytes: number
  readonly sha256: string
}

export interface ExportRequest {
  readonly meetingIDs: readonly string[]
  readonly content: Content
  readonly path?: string
  readonly overwrite: boolean
}

/** A generous cap for 20 long meetings; transcripts stop at it with a visible note. */
const LIMITS: Limits = { maxBytes: 8 * 1024 * 1024, maxPages: 200, pageChars: 80_000 }

/**
 * Room per meeting for what a transcript adds besides its lines: a title from the transcript (front matter
 * and heading) and a closing note, both bounded in length.
 */
const TRANSCRIPT_SLACK = 4096

const CUT: Transcript = { lines: [], end: { kind: "size-limit" } }

export interface ExportContext extends SourceContext {
  readonly permission: Pick<Plugin.Context["permission"], "assert">
}

export interface ExportDependencies {
  readonly ctx: ExportContext
  readonly exportDirectory: string
  readonly limits?: Limits
  readonly now?: () => Date
}

/** The host checks input against EXPORT_INPUT for model calls; this repeats it for every other caller. */
export function parseRequest(raw: unknown): ExportRequest {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw toolError(invalidInput("must be an object"))
  const input = raw as Record<string, unknown>
  const unknown = Object.keys(input).find((key) => !Object.hasOwn(EXPORT_INPUT.properties, key))
  if (unknown !== undefined) throw toolError(invalidInput(`has the unsupported field ${unknown}`, "field"))
  const ids = input.meeting_ids
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_MEETINGS) throw toolError(invalidInput(`needs 1 to ${MAX_MEETINGS} meeting_ids`))
  if (ids.some((id) => typeof id !== "string" || !id.trim() || id.length > 200 || /[\u0000-\u001f\u007f]/.test(id))) {
    throw toolError(invalidInput("has a meeting ID that is empty, too long or not text"))
  }
  if (!CONTENT.includes(input.content as Content)) throw toolError(invalidInput("needs content: notes, transcript or both"))
  if (input.path !== undefined && (typeof input.path !== "string" || !input.path || input.path.length > 512)) {
    throw toolError(invalidInput("has a path that is empty, too long or not text", "path"))
  }
  if (input.overwrite !== undefined && typeof input.overwrite !== "boolean") throw toolError(invalidInput("needs overwrite to be true or false", "overwrite"))
  return {
    meetingIDs: [...new Set(ids as string[])],
    content: input.content as Content,
    ...(input.path !== undefined ? { path: input.path as string } : {}),
    overwrite: input.overwrite === true,
  }
}

const FILESYSTEM: Record<string, string> = {
  EACCES: "permission denied",
  EPERM: "permission denied",
  ENOSPC: "the disk is full",
  EDQUOT: "the disk quota is used up",
  EROFS: "the disk is read-only",
  ENAMETOOLONG: "the path is too long",
  ENOTDIR: "a part of the path is a file, not a folder",
  EXDEV: "the folder does not support an atomic write",
  ENOTSUP: "the folder does not support an atomic write",
  ENOENT: "a folder disappeared during the write",
}

/** Writer and filesystem failures as export problems; cancellation and unexpected errors pass through. */
export function writeProblem(error: unknown, relative: string, maxBytes: number): unknown {
  if (error instanceof MarkdownExportRefusal) {
    switch (error.reason) {
      case "outside":
        return toolError(invalidPath(relative, "leaves the export folder"))
      case "link":
        return toolError(invalidPath(relative, "goes through a link"))
      case "not-a-file":
        return toolError(invalidPath(relative, "goes through or names something that is not a regular file or folder"))
      case "changed":
        return toolError(writeFailed(relative, "the export folder changed during the write"))
      case "too-large":
        return toolError(tooLarge(maxBytes))
    }
  }
  const code = errorCode(error)
  if (code === "EEXIST") return toolError(exists(relative))
  if (code && code !== "ABORT_ERR") return toolError(writeFailed(relative, FILESYSTEM[code] ?? `the system reported ${code}`))
  return error
}

const ENDINGS: Record<Exclude<TranscriptEnd["kind"], "complete">, string> = {
  "unavailable": "no transcript",
  "size-limit": "cut at the size limit",
  "incomplete": "Granola did not return the rest",
}

const notOnPlan = (meeting: Meeting) => meeting.transcript?.end.kind === "unavailable" && meeting.transcript.end.reason === NOT_ON_PLAN

/** What the user and the model see: where the file is, and anything missing from it. */
function summarize(content: Content, meetings: readonly Meeting[], result: ExportResult, cleanupDegraded: boolean): string {
  const blocked = meetings.some(notOnPlan)
  const what = blocked ? "notes" : { notes: "notes", transcript: "transcripts", both: "notes and transcripts" }[content]
  const count = `${meetings.length} meeting${meetings.length === 1 ? "" : "s"}`
  const lines = [`Saved ${what} for ${count} to ${result.path} (${size(result.bytes)}, SHA-256 checksum ${result.sha256}).`]
  if (blocked) lines.push("Transcripts are not available on your Granola plan, so the file has the notes and says so for each meeting.")
  const missing = meetings.filter((meeting) => meeting.notes?.missing).map((meeting) => `\`${meeting.id}\``)
  if (missing.length) lines.push(`Granola returned no notes for ${missing.join(", ")}.`)
  const partial = meetings.flatMap((meeting) => {
    const end = meeting.transcript?.end
    return end && end.kind !== "complete" && !notOnPlan(meeting) ? [`\`${meeting.id}\` (${ENDINGS[end.kind]})`] : []
  })
  if (partial.length) lines.push(`Transcripts not complete: ${partial.join(", ")}.`)
  if (cleanupDegraded) lines.push("A temporary folder starting with .markdown-export- may be left next to the file; it is safe to delete.")
  return lines.join("\n")
}

/**
 * Validates the request and the path, checks that Granola can serve it, asks the user, then reads every
 * meeting and writes one file atomically. Nothing is created or written before the user approves, and a
 * failed read writes nothing.
 */
export async function exportMarkdown(dependencies: ExportDependencies, raw: unknown, context: ToolContext): Promise<{ output: ExportResult; content: string }> {
  const { ctx, exportDirectory } = dependencies
  const limits = dependencies.limits ?? LIMITS
  const now = (dependencies.now ?? (() => new Date()))()
  const request = parseRequest(raw)
  const parts = exportPath(request.path ?? defaultName(request.content, now))
  const relative = parts.join("/")
  try {
    await preflight(exportDirectory, parts, request.overwrite)
  } catch (error) {
    throw writeProblem(error, relative, limits.maxBytes)
  }
  const names = [
    ...(request.content === "transcript" ? [] : ["get_meetings"]),
    ...(request.content === "notes" ? [] : ["get_meeting_transcript"]),
  ]
  const reader = await connect(ctx, names, context, limits)

  await ctx.permission.assert({
    sessionID: context.sessionID,
    agent: context.agent,
    source: { type: "tool", messageID: context.messageID, id: context.id },
    action: toolID(EXPORT_TOOL),
    resources: [relative],
    save: ["*"],
    metadata: { meeting_count: request.meetingIDs.length, content: request.content, overwrite: request.overwrite },
  })

  const notes = new Map<string, Notes>()
  const readAllNotes = async () => {
    for (const id of request.meetingIDs) notes.set(id, await reader.notes(id))
  }
  if (request.content !== "transcript") await readAllNotes()
  const transcripts = request.content !== "notes"
  let content = request.content
  const document = (meetings: readonly Meeting[]) => renderDocument({ content, retrievedAt: now, meetings, maxBytes: limits.maxBytes })
  const meeting = (id: string, transcript?: Transcript): Meeting => ({ id, ...(notes.has(id) ? { notes: notes.get(id)! } : {}), ...(transcript ? { transcript } : {}) })

  // Everything but the transcript lines, measured as rendered; the lines then share what is left.
  const scaffold = Buffer.byteLength(document(request.meetingIDs.map((id) => meeting(id, transcripts ? CUT : undefined))))
  let remaining = limits.maxBytes - scaffold - (transcripts ? TRANSCRIPT_SLACK * request.meetingIDs.length : 0)
  if (remaining < 0) throw toolError(tooLarge(limits.maxBytes))
  const meetings: Meeting[] = []
  for (const id of request.meetingIDs) {
    if (!transcripts) {
      meetings.push(meeting(id))
      continue
    }
    const transcript = remaining > 0 ? await reader.transcript(id, remaining, notes.get(id)?.missing) : { ...CUT, bytes: 0 }
    // Once the limit cuts a transcript, later ones are left out whole rather than squeezed into what is left.
    remaining = transcript.end.kind === "size-limit" ? 0 : remaining - transcript.bytes
    meetings.push(meeting(id, transcript))
  }
  if (request.content === "transcript" && reader.transcriptsBlocked()) {
    // Without transcripts on the user's plan, a transcript export holds the notes, with each meeting saying why.
    await readAllNotes()
    content = "both"
    meetings.splice(0, meetings.length, ...request.meetingIDs.map((id) => meeting(id, { lines: [], end: { kind: "unavailable", reason: NOT_ON_PLAN } })))
  }
  const markdown = document(meetings)

  try {
    context.signal.throwIfAborted()
    const target = await prepare(exportDirectory, parts)
    const written = await writeMarkdownExport({
      destination: target.destination,
      markdown,
      allowedRoots: [target.root],
      maxBytes: limits.maxBytes,
      overwrite: request.overwrite,
      signal: context.signal,
    })
    const output = { path: written.path, bytes: written.bytes, sha256: written.sha256 }
    return { output, content: summarize(content, meetings, output, written.cleanupDegraded === true) }
  } catch (error) {
    throw writeProblem(error, relative, limits.maxBytes)
  }
}

/** Adds granola_export_markdown (tools.granola.export_markdown in Code Mode, next to Granola's own tools). */
export async function registerExport(ctx: ExportContext & { readonly tool: Pick<Plugin.Context["tool"], "transform"> }, options: Pick<Options, "exportDirectory">): Promise<void> {
  await ctx.tool.transform((editor) => {
    editor.add({
      name: EXPORT_TOOL,
      description: EXPORT_DESCRIPTION,
      input: EXPORT_INPUT,
      output: EXPORT_OUTPUT,
      options: { namespace: SERVER },
      execute: (input, context) => exportMarkdown({ ctx, exportDirectory: options.exportDirectory }, input, context),
    })
  })
}
