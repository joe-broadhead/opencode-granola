import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { Error as ToolError, type ToolContext } from "@opencode/plugin/promise/tool"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { EXPORT_INPUT, EXPORT_OUTPUT, exportMarkdown, parseRequest, registerExport, writeProblem, type ExportContext } from "../src/export/index.js"
import { MarkdownExportRefusal } from "../src/io/markdown-export.js"
import type { Limits } from "../src/export/source.js"

type Run = (input: Record<string, unknown>) => Promise<unknown> | unknown

interface Fake {
  ctx: ExportContext
  asks: Record<string, unknown>[]
  calls: { tool: string; input: Record<string, unknown> }[]
}

const context = {
  sessionID: "ses_export",
  agent: "build",
  messageID: "msg_export",
  id: "call_export",
  signal: new AbortController().signal,
  progress: async () => {},
} as unknown as ToolContext

const text = (value: unknown) => ({ output: value, content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }] })

const notesFor = (id: string) => text(`<meetings_data count="1">\n<meeting id="${id}" title="Meeting ${id}" url="https://notes.example.test/d/${id}">\n<summary>Summary of ${id}.</summary>\n</meeting>\n</meetings_data>`)

/** Serves `lines` in pages the way get_meeting_transcript does: cut at a line, with next_offset while truncated. */
function transcriptOf(lines: string[], pageChars = 60): Run {
  const whole = lines.join("\n")
  return ({ offset = 0 }) => {
    const start = offset as number
    let end = Math.min(whole.length, start + pageChars)
    if (end < whole.length) end = whole.lastIndexOf("\n", end) + 1
    const truncated = end < whole.length
    return text({ transcript: whole.slice(start, end), total_chars: whole.length, truncated, ...(truncated ? { next_offset: end } : {}) })
  }
}

function fake(options: {
  tools?: Record<string, Run>
  state?: { status: string; error?: string }
  decide?: (input: Record<string, unknown>) => Promise<void> | void
} = {}): Fake {
  const tools = options.tools ?? { get_meetings: ({ meeting_ids }) => notesFor((meeting_ids as string[])[0]!), get_meeting_transcript: transcriptOf(["Ada: Hello.", "Lin: Hi."]) }
  const fake: Fake = { ctx: undefined as unknown as ExportContext, asks: [], calls: [] }
  fake.ctx = {
    tool: {
      list: async () => Object.entries(tools).map(([name, run]) => ({
        id: `granola_${name}`,
        name,
        execute: async (input: Record<string, unknown>) => {
          fake.calls.push({ tool: name, input })
          return run(input)
        },
      })),
    },
    mcp: { list: async () => ({ location: {}, data: [{ name: "granola", status: options.state ?? { status: "connected" } }] }) },
    permission: {
      assert: async (input: Record<string, unknown>) => {
        fake.asks.push(input)
        await options.decide?.(input)
      },
    },
  } as unknown as ExportContext
  return fake
}

async function failure(promise: Promise<unknown>): Promise<Error & { metadata?: { code?: string; next?: string } }> {
  try {
    await promise
  } catch (error) {
    return error as Error
  }
  throw new Error("expected the export to fail")
}

describe("export_markdown", () => {
  let temporary: string
  let root: string

  beforeEach(async () => {
    temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "granola-export-tool-")))
    root = path.join(temporary, "Granola")
  })

  afterEach(async () => {
    await fs.chmod(root, 0o700).catch(() => {})
    await fs.rm(temporary, { recursive: true, force: true })
  })

  const now = () => new Date("2026-10-30T14:05:09.000Z")
  const run = (host: Fake, input: Record<string, unknown>, limits?: Limits) =>
    exportMarkdown({ ctx: host.ctx, exportDirectory: root, now, ...(limits ? { limits } : {}) }, input, context)
  const listing = async () => fs.readdir(root, { recursive: true }).catch(() => "no export folder")

  describe("registration and input", () => {
    it("adds granola_export_markdown with a closed snake_case input and an output schema", async () => {
      const added: Record<string, unknown>[] = []
      const host = fake()
      const transform = async (callback: (editor: never) => void) => {
        callback({ add: (tool: Record<string, unknown>) => added.push(tool) } as never)
        return { dispose: async () => {} }
      }
      await registerExport({ ...host.ctx, tool: { ...host.ctx.tool, transform } }, { exportDirectory: root })
      expect(added).toHaveLength(1)
      expect(added[0]).toMatchObject({ name: "export_markdown", input: EXPORT_INPUT, output: EXPORT_OUTPUT, options: { namespace: "granola" } })
      expect(EXPORT_INPUT.additionalProperties).toBe(false)
      expect(Object.keys(EXPORT_INPUT.properties)).toEqual(["meeting_ids", "content", "path", "overwrite"])
      expect(EXPORT_INPUT.properties.meeting_ids).toMatchObject({ minItems: 1, maxItems: 20 })
      expect(EXPORT_OUTPUT.required).toEqual(["path", "bytes", "sha256"])
    })

    const REQUIRED = "Pass meeting_ids (1 to 20 meeting IDs) and content (notes, transcript or both)."
    const ONLY = "Pass only meeting_ids, content, path and overwrite."
    const PATH = "Pass path as a relative path of at most 512 characters, or leave it out."
    const OVERWRITE = "Pass overwrite as true or false, or leave it out."
    it.each([
      [{ meetingIds: ["m-1"], content: "notes" }, "unsupported field meetingIds", ONLY],
      [{ meeting_ids: ["m-1"], content: "notes", toString: "x" }, "unsupported field toString", ONLY],
      [{ meeting_ids: [], content: "notes" }, "needs 1 to 20 meeting_ids", REQUIRED],
      [{ meeting_ids: Array.from({ length: 21 }, (_, i) => `m-${i}`), content: "notes" }, "needs 1 to 20 meeting_ids", REQUIRED],
      [{ meeting_ids: [" "], content: "notes" }, "meeting ID that is empty", REQUIRED],
      [{ meeting_ids: ["m-1"], content: "summary" }, "needs content", REQUIRED],
      [{ meeting_ids: ["m-1"], content: "notes", overwrite: "yes" }, "overwrite to be true or false", OVERWRITE],
      [{ meeting_ids: ["m-1"], content: "notes", path: "" }, "path that is empty", PATH],
    ])("refuses %j with the next step for that problem", (input, reason, next) => {
      let error: (Error & { metadata?: { code?: string; next?: string } }) | undefined
      try {
        parseRequest(input)
      } catch (caught) {
        error = caught as typeof error
      }
      expect(error?.metadata?.code).toBe("EXPORT_INVALID_INPUT")
      expect(error?.message).toContain(reason)
      expect(error?.metadata?.next).toBe(next)
    })

    it("keeps the meeting order and drops repeated IDs", () => {
      expect(parseRequest({ meeting_ids: ["b", "a", "b"], content: "both" })).toEqual({ meetingIDs: ["b", "a"], content: "both", overwrite: false })
    })
  })

  describe("permission", () => {
    it("asks once for the relative path, with the meeting count, content kind and overwrite", async () => {
      const host = fake()
      await run(host, { meeting_ids: ["m-1", "m-2"], content: "both", path: "team/weekly" })
      expect(host.asks).toEqual([{
        sessionID: "ses_export",
        agent: "build",
        source: { type: "tool", messageID: "msg_export", id: "call_export" },
        action: "granola_export_markdown",
        resources: ["team/weekly.md"],
        save: ["*"],
        metadata: { meeting_count: 2, content: "both", overwrite: false },
      }])
    })

    it("writes, creates and reads nothing when the user rejects, and rethrows the rejection unchanged", async () => {
      const rejection = { _tag: "Permission.DeclinedError" }
      const host = fake({ decide: () => Promise.reject(rejection) })
      await expect(run(host, { meeting_ids: ["m-1"], content: "both", path: "a/b/notes.md" })).rejects.toBe(rejection)
      expect(host.calls).toEqual([])
      expect(await listing()).toBe("no export folder")
    })
  })

  describe("an approved export", () => {
    it("creates the export folder and writes one readable file, returning its path, bytes and SHA-256", async () => {
      const host = fake()
      const result = await run(host, { meeting_ids: ["m-1"], content: "both" })
      const file = path.join(root, "granola-both-20261030-140509Z.md")
      const data = await fs.readFile(file)
      expect(result.output).toEqual({ path: file, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") })
      expect(result.content).toBe(`Saved notes and transcripts for 1 meeting to ${file} (${data.length} bytes, SHA-256 checksum ${result.output.sha256}).`)
      expect(await listing()).toEqual(["granola-both-20261030-140509Z.md"])
      expect((await fs.stat(root)).mode & 0o777).toBe(0o700)
      expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
      const markdown = data.toString("utf8")
      expect(markdown).toMatch(/^---\nsource: Granola\nretrieved_at: "2026-10-30T14:05:09.000Z"\ncontent: both\n/)
      expect(markdown).toContain("## Meeting m-1\n\n- Meeting ID: `m-1`\n- Link: <https://notes.example.test/d/m-1>\n\n### Notes\n\n#### Summary\n\nSummary of m-1.\n\n### Transcript\n\nAda: Hello.\n\nLin: Hi.\n")
      expect(host.calls.map((call) => call.tool)).toEqual(["get_meetings", "get_meeting_transcript"])
    })

    it("reads only what the content kind needs", async () => {
      const notes = fake()
      await run(notes, { meeting_ids: ["m-1"], content: "notes", path: "n.md" })
      expect(notes.calls.map((call) => call.tool)).toEqual(["get_meetings"])
      const transcript = fake()
      await run(transcript, { meeting_ids: ["m-1"], content: "transcript", path: "t.md" })
      expect(transcript.calls.map((call) => call.tool)).toEqual(["get_meeting_transcript"])
    })

    it("refuses an existing file before asking, and replaces it only with overwrite", async () => {
      await fs.mkdir(root)
      await fs.writeFile(path.join(root, "notes.md"), "old")
      const refused = fake()
      const error = await failure(run(refused, { meeting_ids: ["m-1"], content: "notes", path: "notes.md" }))
      expect(error.metadata?.code).toBe("EXPORT_EXISTS")
      expect(error.message).toContain("Next step: Choose another path, or ask the user before you export again with overwrite: true.")
      expect([refused.asks, refused.calls]).toEqual([[], []])
      const replaced = fake()
      await run(replaced, { meeting_ids: ["m-1"], content: "notes", path: "notes.md", overwrite: true })
      expect(replaced.asks[0]!.metadata).toEqual({ meeting_count: 1, content: "notes", overwrite: true })
      expect(await fs.readFile(path.join(root, "notes.md"), "utf8")).toContain("Summary of m-1.")
    })

    it.each(["../escape.md", "/tmp/escape.md"])("refuses %s before asking or reading", async (target) => {
      const host = fake()
      const error = await failure(run(host, { meeting_ids: ["m-1"], content: "notes", path: target }))
      expect(error.metadata?.code).toBe("EXPORT_INVALID_PATH")
      expect([host.asks, host.calls]).toEqual([[], []])
      expect(await listing()).toBe("no export folder")
    })

    it("refuses a link that appears in the path while the meetings are read", async () => {
      const outside = path.join(temporary, "outside")
      await fs.mkdir(outside)
      await fs.mkdir(root)
      const host = fake({
        tools: {
          get_meetings: async ({ meeting_ids }) => {
            await fs.symlink(outside, path.join(root, "a"))
            return notesFor((meeting_ids as string[])[0]!)
          },
        },
      })
      const error = await failure(run(host, { meeting_ids: ["m-1"], content: "notes", path: "a/notes.md" }))
      expect(error.metadata?.code).toBe("EXPORT_INVALID_PATH")
      expect(await fs.readdir(outside)).toEqual([])
      expect(await listing()).toEqual(["a"])
    })

    it("reports a folder it cannot write to with a next step", async () => {
      if (process.getuid?.() === 0) return
      await fs.mkdir(root, { mode: 0o500 })
      const error = await failure(run(fake(), { meeting_ids: ["m-1"], content: "notes", path: "notes.md" }))
      expect(error.metadata?.code).toBe("EXPORT_WRITE_FAILED")
      expect(error.message).toBe("EXPORT_WRITE_FAILED: Could not write `notes.md` in the export folder: permission denied. Next step: Make sure the export folder that /granola-status shows is writable and has free space, then export again.")
    })

    it("stops before writing when the call is cancelled", async () => {
      const controller = new AbortController()
      const host = fake({ tools: { get_meetings: ({ meeting_ids }) => (controller.abort(), notesFor((meeting_ids as string[])[0]!)) } })
      const cancelled = exportMarkdown({ ctx: host.ctx, exportDirectory: root, now }, { meeting_ids: ["m-1"], content: "notes" }, { ...context, signal: controller.signal })
      await expect(cancelled).rejects.toMatchObject({ name: "AbortError" })
      expect(await listing()).toBe("no export folder")
    })
  })

  describe("writer failures", () => {
    it.each([
      ["outside", "EXPORT_INVALID_PATH", "leaves the export folder"],
      ["link", "EXPORT_INVALID_PATH", "goes through a link"],
      ["not-a-file", "EXPORT_INVALID_PATH", "is not a regular file or folder"],
      ["changed", "EXPORT_WRITE_FAILED", "the export folder changed during the write"],
      ["too-large", "EXPORT_TOO_LARGE", "larger than its 8 MB limit"],
    ] as const)("maps the writer's %s refusal to %s", (reason, code, message) => {
      const error = writeProblem(new MarkdownExportRefusal(reason, "refused"), "notes.md", 8 * 1024 * 1024) as ToolError
      expect(error).toBeInstanceOf(ToolError)
      expect(error.metadata).toMatchObject({ code })
      expect(error.message).toContain(message)
    })

    it("passes a cancellation and an unexpected error through unchanged", () => {
      for (const error of [Object.assign(new Error("aborted"), { code: "ABORT_ERR" }), new TypeError("bug")]) {
        expect(writeProblem(error, "notes.md", 1024)).toBe(error)
      }
    })
  })

  describe("transcript paging", () => {
    it("takes text that starts with { but is not JSON as the whole transcript", async () => {
      const host = fake({ tools: { get_meeting_transcript: () => ({ content: [{ type: "text", text: "{Ada}: Hello, not JSON." }] }) } })
      const result = await run(host, { meeting_ids: ["m-1"], content: "transcript", path: "t.md" }, limits())
      expect(await fs.readFile(result.output.path, "utf8")).toContain("{Ada}: Hello, not JSON.")
    })

    const limits = (overrides: Partial<Limits> = {}): Limits => ({ maxBytes: 1024 * 1024, maxPages: 50, pageChars: 1000, ...overrides })
    const lines = Array.from({ length: 30 }, (_, i) => `Speaker ${i % 2}: line ${i + 1}.`)

    it("follows next_offset until Granola says the transcript is complete", async () => {
      const host = fake({ tools: { get_meeting_transcript: transcriptOf(lines, 100) } })
      const result = await run(host, { meeting_ids: ["m-1"], content: "transcript", path: "t.md" }, limits())
      const offsets = host.calls.map((call) => call.input.offset)
      expect(offsets.length).toBeGreaterThan(3)
      expect(offsets[0]).toBe(0)
      expect(host.calls.every((call) => call.input.meeting_id === "m-1" && call.input.max_chars === 1000)).toBe(true)
      const markdown = await fs.readFile(result.output.path, "utf8")
      expect(markdown).toContain(`### Transcript\n\n${lines.join("\n\n")}\n`)
      expect(result.content).not.toContain("not complete")
    })

    it("joins an utterance that Granola split across two pages", async () => {
      const pages = [
        { transcript: "Ada: first.\nLin: the start of a long", truncated: true, next_offset: 37, ends_mid_utterance: true },
        { transcript: " sentence.\nAda: last.", truncated: false },
      ]
      const host = fake({ tools: { get_meeting_transcript: ({ offset }) => text(pages[offset === 0 ? 0 : 1]) } })
      const result = await run(host, { meeting_ids: ["m-1"], content: "transcript", path: "t.md" }, limits())
      expect(await fs.readFile(result.output.path, "utf8")).toContain("Ada: first.\n\nLin: the start of a long sentence.\n\nAda: last.\n")
    })

    it("stops when next_offset does not advance, and says so", async () => {
      const host = fake({ tools: { get_meeting_transcript: () => text({ transcript: "Ada: again.", truncated: true, next_offset: 0 }) } })
      const result = await run(host, { meeting_ids: ["m-1"], content: "transcript", path: "t.md" }, limits())
      expect(host.calls).toHaveLength(1)
      expect(await fs.readFile(result.output.path, "utf8")).toContain("Ada: again.\n\n_The transcript stops here: Granola did not return the rest.")
      expect(result.content).toContain("Transcripts not complete: `m-1` (Granola did not return the rest).")
    })

    it("stops at the page limit", async () => {
      const host = fake({ tools: { get_meeting_transcript: ({ offset }) => text({ transcript: `Line at ${offset}.`, truncated: true, next_offset: (offset as number) + 10 }) } })
      const result = await run(host, { meeting_ids: ["m-1"], content: "transcript", path: "t.md" }, limits({ maxPages: 3 }))
      expect(host.calls.map((call) => call.input.offset)).toEqual([0, 10, 20])
      expect(await fs.readFile(result.output.path, "utf8")).toContain("Line at 20.\n\n_The transcript stops here: Granola did not return the rest.")
    })

    it("cuts at a whole utterance when the size limit is reached, and skips later transcripts", async () => {
      const long = Array.from({ length: 400 }, (_, i) => `Speaker ${i % 3}: utterance number ${i + 1} with some padding.`)
      const host = fake({
        tools: {
          get_meeting_transcript: ({ meeting_id, offset }) => (meeting_id === "m-1" ? transcriptOf(long, 2000)({ offset }) : text({ transcript: "never read", truncated: false })),
        },
      })
      const maxBytes = 12 * 1024
      const result = await run(host, { meeting_ids: ["m-1", "m-2"], content: "transcript", path: "t.md" }, limits({ maxBytes }))
      const markdown = await fs.readFile(result.output.path, "utf8")
      expect(result.output.bytes).toBeLessThanOrEqual(maxBytes)
      const kept = markdown.match(/^Speaker \d: utterance number \d+ with some padding\.$/gm) ?? []
      expect(kept.length).toBeGreaterThan(10)
      expect(kept).toEqual(long.slice(0, kept.length))
      expect(markdown).toContain(`${long[kept.length - 1]}\n\n_The transcript stops here: the export reached its 12 KB size limit.`)
      expect(markdown).toContain("## Meeting `m-2`")
      expect(markdown).toContain("_Transcript not included: the export reached its 12 KB size limit.")
      expect(host.calls.some((call) => call.input.meeting_id === "m-2")).toBe(false)
      expect(result.content).toContain("Transcripts not complete: `m-1` (cut at the size limit), `m-2` (cut at the size limit).")
    })

    it("records Granola's reason when a meeting has no transcript", async () => {
      const host = fake({ tools: { get_meeting_transcript: () => text({ transcript: null, transcript_unavailable: { reason: "transcript_pending" } }) } })
      const result = await run(host, { meeting_ids: ["m-1"], content: "transcript", path: "t.md" }, limits())
      expect(await fs.readFile(result.output.path, "utf8")).toContain("_No transcript: Granola is still processing it; export again in a few minutes._")
      expect(result.content).toContain("`m-1` (no transcript)")
    })

    it("takes text that is not JSON as the whole transcript", async () => {
      const host = fake({ tools: { get_meeting_transcript: () => ({ content: [{ type: "text", text: "Ada: plain.\nLin: text." }] }) } })
      const result = await run(host, { meeting_ids: ["m-1"], content: "transcript", path: "t.md" }, limits())
      expect(host.calls).toHaveLength(1)
      expect(await fs.readFile(result.output.path, "utf8")).toContain("Ada: plain.\n\nLin: text.\n")
    })
  })

  describe("without transcripts on the user's Granola plan", () => {
    const PLAN_ERROR = "Transcripts are only available to paid Granola tiers. Do not retry unless the plan changes. Review your Granola plan: https://plans.example.test"
    const refusing = (extra: Record<string, Run> = {}) => fake({
      tools: {
        get_meetings: ({ meeting_ids }) => notesFor((meeting_ids as string[])[0]!),
        get_meeting_transcript: () => Promise.reject(new ToolError({ message: PLAN_ERROR })),
        ...extra,
      },
    })
    const PLAN_LINE = "_No transcript: transcripts are not available on your Granola plan._"

    it("both: writes the notes, says so for each meeting, and asks Granola once", async () => {
      const host = refusing()
      const result = await run(host, { meeting_ids: ["m-1", "m-2"], content: "both", path: "b.md" })
      const markdown = await fs.readFile(result.output.path, "utf8")
      expect(markdown).toContain("Summary of m-1.")
      expect(markdown).toContain("Summary of m-2.")
      expect(markdown.split(PLAN_LINE)).toHaveLength(3)
      expect(host.calls.filter((call) => call.tool === "get_meeting_transcript")).toHaveLength(1)
      expect(result.content).toContain("Saved notes for 2 meetings")
      expect(result.content).toContain("Transcripts are not available on your Granola plan")
      expect(result.content).not.toContain("Transcripts not complete")
      expect(result.content).not.toMatch(/meeting ID|plans\.example/)
    })

    it("transcript: writes the notes instead, with the same line", async () => {
      const host = refusing()
      const result = await run(host, { meeting_ids: ["m-1"], content: "transcript", path: "t.md" })
      const markdown = await fs.readFile(result.output.path, "utf8")
      expect(markdown).toContain("content: both")
      expect(markdown).toContain("### Notes\n\n#### Summary\n\nSummary of m-1.")
      expect(markdown).toContain(`### Transcript\n\n${PLAN_LINE}`)
      expect(host.asks).toHaveLength(1)
    })

    it("treats a transcript tool that Granola does not list as the same plan limit", async () => {
      const host = fake({ tools: { get_meetings: ({ meeting_ids }) => notesFor((meeting_ids as string[])[0]!) } })
      const result = await run(host, { meeting_ids: ["m-1"], content: "both", path: "n.md" })
      expect(await fs.readFile(result.output.path, "utf8")).toContain(PLAN_LINE)
      expect(host.calls.map((call) => call.tool)).toEqual(["get_meetings"])
    })

    it("notes: never touches transcripts", async () => {
      const host = refusing()
      const result = await run(host, { meeting_ids: ["m-1"], content: "notes", path: "o.md" })
      expect(await fs.readFile(result.output.path, "utf8")).not.toContain("Transcript")
      expect(host.calls.map((call) => call.tool)).toEqual(["get_meetings"])
    })
  })

  describe("failures", () => {
    it("refuses notes larger than the limit and writes nothing", async () => {
      const host = fake({ tools: { get_meetings: () => text(`<meeting id="m"><summary>${"x".repeat(5000)}</summary></meeting>`) } })
      const error = await failure(run(host, { meeting_ids: ["m-1"], content: "notes", path: "n.md" }, { maxBytes: 4096, maxPages: 5, pageChars: 1000 }))
      expect(error.metadata?.code).toBe("EXPORT_TOO_LARGE")
      expect(error.message).toContain("larger than its 4 KB limit. Next step: Export fewer meetings at a time.")
      expect(await listing()).toBe("no export folder")
    })

    it("asks the user to sign in, before asking to export, when Granola's tools are missing", async () => {
      const host = fake({ tools: {}, state: { status: "needs_auth", error: "visit https://auth.example.test/authorize?code=secret" } })
      const error = await failure(run(host, { meeting_ids: ["m-1"], content: "notes" }))
      expect(error.metadata?.code).toBe("AUTH_REQUIRED")
      expect(error.message).not.toContain("auth.example.test")
      expect(host.asks).toEqual([])
    })

    it("names the missing tool when Granola is connected without get_meetings", async () => {
      const host = fake({ tools: { get_meeting_transcript: transcriptOf(["Ada: Hi."]) } })
      const error = await failure(run(host, { meeting_ids: ["m-1"], content: "notes" }))
      expect(error.metadata?.code).toBe("TOOL_UNAVAILABLE")
      expect(error.message).toContain("Granola does not offer get_meetings for this account.")
      expect(host.asks).toEqual([])
    })

    it("maps the host's unavailable-server error to the connection state", async () => {
      const host = fake({
        state: { status: "failed", error: "socket hang up" },
        tools: { get_meetings: () => Promise.reject(new ToolError({ message: 'MCP server "granola" is not available' })) },
      })
      const error = await failure(run(host, { meeting_ids: ["m-1"], content: "notes" }))
      expect(error.metadata?.code).toBe("CONNECTION_FAILED")
      expect(error.message).toContain("Granola connection failed: socket hang up.")
      expect(await listing()).toBe("no export folder")
    })

    it("names the meeting when Granola fails a read, and writes nothing", async () => {
      const host = fake({
        tools: {
          get_meetings: ({ meeting_ids }) => notesFor((meeting_ids as string[])[0]!),
          get_meeting_transcript: ({ meeting_id }) => (meeting_id === "m-2" ? Promise.reject(new ToolError({ message: "rate_limit: retry in 30 seconds" })) : transcriptOf(["Ada: Hi."])({})),
        },
      })
      const error = await failure(run(host, { meeting_ids: ["m-1", "m-2"], content: "both", path: "x.md" }))
      expect(error.metadata?.code).toBe("EXPORT_READ_FAILED")
      expect(error.message).toContain("Granola could not return the transcript of meeting `m-2`: rate_limit: retry in 30 seconds. Nothing was written.")
      expect(error.message).toContain("Next step: Export again without that meeting.")
      expect(await listing()).toBe("no export folder")
    })

    it("passes a denied or corrected read through unchanged", async () => {
      const denied = new ToolError({ message: "Permission denied: granola_get_meetings", error: new Error("blocked") })
      const host = fake({ tools: { get_meetings: () => Promise.reject(denied) } })
      await expect(run(host, { meeting_ids: ["m-1"], content: "notes" })).rejects.toBe(denied)
      expect(await listing()).toBe("no export folder")
    })

    it("records an ID that Granola does not know instead of failing the export", async () => {
      const host = fake({
        tools: {
          get_meetings: ({ meeting_ids }) => text((meeting_ids as string[])[0] === "zzz" ? "<not_found_hint>No meeting matches these IDs.</not_found_hint>" : notesFor("m-1").output),
          get_meeting_transcript: ({ meeting_id }) => (meeting_id === "zzz" ? Promise.reject(new ToolError({ message: "Meeting not found" })) : transcriptOf(["Ada: Hi."])({})),
        },
      })
      const result = await run(host, { meeting_ids: ["m-1", "zzz"], content: "both", path: "x.md" })
      const markdown = await fs.readFile(result.output.path, "utf8")
      expect(markdown).toContain("## Meeting `zzz`")
      expect(markdown).toContain("_No transcript: Granola returned no meeting for this ID._")
      expect(result.content).toContain("Granola returned no notes for `zzz`.")
    })
  })
})
