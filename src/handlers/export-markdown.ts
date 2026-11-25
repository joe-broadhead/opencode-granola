/**
 * `export_markdown`: save notes, transcripts or both for 1 to 20 meetings to one Markdown file in the export folder.
 *
 * A local file write, class `export`: under `ask-changes` the register asks first, and under `read-only` it is denied.
 * Nothing is created or written before the request and path pass their checks, and a failed provider read writes
 * nothing. There is no plan/commit pair: the output is a local file, and `overwrite: false` plus the access rule are
 * the confirmation.
 */
import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import { SourceError } from "@we-the-rebel-alliance/plugin-contract/events"
import { connect, NOT_ON_PLAN } from "../provider/transcript.ts"
import { defaultName, exportPath, errorCode, preflight, prepare } from "../export/paths.ts"
import { exists, invalidInput, invalidPath, tooLarge, writeFailed } from "../export/errors.ts"
import { MarkdownExportRefusal, writeMarkdownExport } from "../export/write.ts"
import { renderDocument, type Content, type Meeting, type Notes, type Transcript } from "../export/render.ts"
import type { HandlerRuntime } from "./index.ts"

const CONTENT = ["notes", "transcript", "both"] as const
const MAX_MEETINGS = 20
/** A generous cap for 20 long meetings; transcripts stop at it with a visible note. */
const LIMITS = { maxBytes: 8 * 1024 * 1024, maxPages: 200, pageChars: 80_000 }
const TRANSCRIPT_MARGIN = 4096
const CUT: Transcript = { lines: [], end: { kind: "size-limit" } }

const EXPORT_INPUT = {
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

const EXPORT_OUTPUT = {
  type: "object",
  additionalProperties: false,
  required: ["path", "bytes", "sha256"],
  properties: {
    path: { type: "string", description: "Absolute path of the written file." },
    bytes: { type: "integer", minimum: 0 },
    sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
  },
} as const

interface ExportRequest {
  readonly meetingIDs: readonly string[]
  readonly content: Content
  readonly path?: string
  readonly overwrite: boolean
}

/** The handler's own check, for a caller the host's schema validation did not run for. */
function parseRequest(raw: unknown): ExportRequest {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw invalidInput("must be an object", "Pass meeting_ids and content.")
  const input = raw as Record<string, unknown>
  const unknown = Object.keys(input).find((key) => !Object.hasOwn(EXPORT_INPUT.properties, key))
  if (unknown !== undefined) throw invalidInput(`has the unsupported field ${unknown}`, "Pass only meeting_ids, content, path and overwrite.")
  const ids = input["meeting_ids"]
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > MAX_MEETINGS) throw invalidInput(`needs 1 to ${MAX_MEETINGS} meeting_ids`, "Pass meeting_ids, 1 to 20 IDs.")
  if (ids.some((id) => typeof id !== "string" || !id.trim() || id.length > 200 || /\p{Cc}/u.test(id))) {
    throw invalidInput("has a meeting ID that is empty, too long or not text", "Pass meeting IDs as text of at most 200 characters.")
  }
  if (!CONTENT.includes(input["content"] as Content)) throw invalidInput("needs content: notes, transcript or both", "Pass content as notes, transcript or both.")
  if (input["path"] !== undefined && (typeof input["path"] !== "string" || !input["path"] || input["path"].length > 512)) {
    throw invalidInput("has a path that is empty, too long or not text", "Pass path as a relative path of at most 512 characters, or leave it out.")
  }
  if (input["overwrite"] !== undefined && typeof input["overwrite"] !== "boolean") {
    throw invalidInput("needs overwrite to be true or false", "Pass overwrite as true or false, or leave it out.")
  }
  return {
    meetingIDs: [...new Set(ids as string[])],
    content: input["content"] as Content,
    ...(input["path"] !== undefined ? { path: input["path"] as string } : {}),
    overwrite: input["overwrite"] === true,
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

/** Writer and filesystem failures as export refusals; cancellation and unexpected errors pass through. */
function writeProblem(error: unknown, relative: string, maxBytes: number): unknown {
  if (error instanceof SourceError) return error
  if (error instanceof MarkdownExportRefusal) {
    switch (error.reason) {
      case "outside":
        return invalidPath(relative, "leaves the export folder")
      case "link":
        return invalidPath(relative, "goes through a link")
      case "not-a-file":
        return invalidPath(relative, "goes through or names something that is not a regular file or folder")
      case "changed":
        return writeFailed(relative, "the export folder changed during the write")
      case "too-large":
        return tooLarge(maxBytes)
    }
  }
  const code = errorCode(error)
  if (code === "EEXIST") return exists(relative)
  if (code && code !== "ABORT_ERR") return writeFailed(relative, FILESYSTEM[code] ?? `the system reported ${code}`)
  return error
}

/** `export_markdown`: the handler the register wires as a tool, in Code Mode and over RPC. */
export function exportMarkdownHandler(runtime: HandlerRuntime): MethodHandler {
  return {
    description:
      "Save Granola meeting notes, transcripts or both, for 1 to 20 meetings, to one Markdown file in the user's export folder. Returns the file's path, size and SHA-256 checksum.",
    input: EXPORT_INPUT,
    output: EXPORT_OUTPUT,
    async run(input, call) {
      const now = new Date(runtime.clock())
      const request = parseRequest(input)
      const parts = exportPath(request.path ?? defaultName(request.content, now))
      const relative = parts.join("/")
      try {
        await preflight(runtime.exportDirectory, parts, request.overwrite)
      } catch (error) {
        throw writeProblem(error, relative, LIMITS.maxBytes)
      }
      const names = [...(request.content === "transcript" ? [] : ["get_meetings"]), ...(request.content === "notes" ? [] : ["get_meeting_transcript"])]
      const reader = await connect(
        runtime.provider.reader(call, call.account),
        (tool) => runtime.provider.has(call.account, tool),
        names,
        call.signal,
        LIMITS,
      )

      const notes = new Map<string, Notes>()
      const readAllNotes = async () => {
        for (const id of request.meetingIDs) notes.set(id, await reader.notes(id))
      }
      if (request.content !== "transcript") await readAllNotes()
      const transcripts = request.content !== "notes"
      let content = request.content
      const document = (meetings: readonly Meeting[]) => renderDocument({ content, retrievedAt: now, meetings, maxBytes: LIMITS.maxBytes })
      const meeting = (id: string, transcript?: Transcript): Meeting => ({ id, ...(notes.has(id) ? { notes: notes.get(id)! } : {}), ...(transcript ? { transcript } : {}) })

      // Everything but the transcript lines, measured as rendered; the lines then share what is left.
      const scaffold = Buffer.byteLength(document(request.meetingIDs.map((id) => meeting(id, transcripts ? CUT : undefined))))
      let remaining = LIMITS.maxBytes - scaffold - (transcripts ? TRANSCRIPT_MARGIN * request.meetingIDs.length : 0)
      if (remaining < 0) throw tooLarge(LIMITS.maxBytes)
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
        call.signal.throwIfAborted()
        const target = await prepare(runtime.exportDirectory, parts)
        const written = await writeMarkdownExport({
          destination: target.destination,
          markdown,
          allowedRoots: [target.root],
          maxBytes: LIMITS.maxBytes,
          overwrite: request.overwrite,
          signal: call.signal,
        })
        const output = { path: written.path, bytes: written.bytes, sha256: written.sha256 }
        return output
      } catch (error) {
        throw writeProblem(error, relative, LIMITS.maxBytes)
      }
    },
  }
}

export { EXPORT_INPUT, EXPORT_OUTPUT }
export type { ExportRequest }
