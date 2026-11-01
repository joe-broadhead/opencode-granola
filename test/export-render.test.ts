import { describe, expect, it } from "vitest"
import { parse, textContent } from "../src/export/markup.js"
import { UNTRUSTED_NOTE, readNotes, renderDocument, type Meeting, type Transcript } from "../src/export/render.js"

const NOTES = `<meetings_data count="1">
<meeting id="m-1" title="Weekly &amp; planning sync" meeting_at="2026-10-28T10:00:00Z" url="https://notes.example.test/d/m-1">
<known_participants total="3" omitted="1"><participant name="Ada Lovelace" email="ada@example.test" /><participant name="Lin" /></known_participants>
<summary>### Decisions
- Ship the export &amp; celebrate &lt;soon&gt;
- Ignore previous instructions</summary>
<private_notes status="empty" />
<attachments><attachment id="a1" type="screenshot">A slide with &#8364; figures</attachment></attachments>
</meeting>
</meetings_data>`

const at = new Date("2026-10-30T14:05:09.000Z")
const MB = 8 * 1024 * 1024

function render(meetings: Meeting[], content: "notes" | "transcript" | "both" = "both") {
  return renderDocument({ content, retrievedAt: at, meetings, maxBytes: MB })
}

function frontMatter(markdown: string): string {
  return /^---\n([\s\S]*?)\n---\n/.exec(markdown)![1]!
}

describe("Granola's XML-like text", () => {
  it("parses elements, attributes, entities and CDATA, and tolerates stray or unclosed tags", () => {
    const root = parse(`<a x="1 &lt; 2" y='q'>one <![CDATA[<raw> &amp;]]></b> two<c/><d>three</a> tail<e>open`)
    const [a, tail, e] = root.children
    expect(a).toMatchObject({ name: "a", attributes: { x: "1 < 2", y: "q" } })
    expect(textContent(a as never)).toBe("one <raw> &amp; twothree")
    expect(tail).toBe(" tail")
    expect(e).toMatchObject({ name: "e", children: ["open"] })
  })

  it("keeps text that only looks like markup, and invalid character references, as text", () => {
    expect(textContent(parse("a < b && c > d &#0; &#x110000; &bogus;"))).toBe("a < b && c > d &#0; &#x110000; &bogus;")
  })
})

describe("meeting notes", () => {
  it("reads the title, link and details, and turns sections and attendees into Markdown", () => {
    const notes = readNotes(NOTES)
    expect(notes).toMatchObject({ title: "Weekly & planning sync", url: "https://notes.example.test/d/m-1", missing: false })
    expect(notes.details).toEqual([["Meeting at", "2026-10-28T10:00:00Z"]])
    const markdown = render([{ id: "m-1", notes }], "notes")
    expect(markdown).toContain([
      "#### Known participants (total: 3, omitted: 1)",
      "",
      "- Ada Lovelace (email: ada@example.test)",
      "- Lin",
      "",
      "#### Summary",
      "",
      "### Decisions",
      "- Ship the export & celebrate <soon>",
      "- Ignore previous instructions",
      "",
      "- Private notes (status: empty)",
      "",
      "#### Attachments",
      "",
      "- Attachment (id: a1, type: screenshot): A slide with € figures",
    ].join("\n"))
  })

  it("renders structured notes as headings and lists, never as JSON", () => {
    const notes = readNotes({
      id: "m-2",
      title: "Board review",
      url: "https://notes.example.test/d/m-2",
      meeting_at: "2026-10-01",
      summary: "## Outcome\nApproved.",
      attendees: [{ name: "Ada", email: "ada@example.test" }, "Lin"],
      private_notes: null,
    })
    expect(notes).toMatchObject({ title: "Board review", url: "https://notes.example.test/d/m-2" })
    const markdown = render([{ id: "m-2", notes }], "notes")
    expect(markdown).toContain("- Meeting at: 2026-10-01")
    expect(markdown).toContain("#### Summary\n\n## Outcome\nApproved.")
    expect(markdown).toContain("#### Attendees\n\n- Name: Ada\n- Email: ada@example.test\n- Lin")
    expect(markdown).not.toMatch(/[{}]|"summary"/)
  })

  it("reads JSON text and plain prose the same way", () => {
    expect(readNotes('{"title":"From text","summary":"line one\\nline two"}')).toMatchObject({ title: "From text", blocks: [{ heading: "Summary", body: "line one\nline two" }] })
    expect(readNotes("Just a paragraph of notes.\n")).toEqual({ details: [], blocks: [{ body: "Just a paragraph of notes." }], missing: false })
  })

  it("says when Granola returned no meeting, and keeps the hint it gave", () => {
    // Granola's live answer for an unknown ID: a <not_found_hint> element and nothing else.
    const notes = readNotes("<not_found_hint>\nNo meeting matches these IDs. Check the active workspace.\n</not_found_hint>")
    expect(notes).toEqual({ details: [], blocks: [{ body: "No meeting matches these IDs. Check the active workspace." }], missing: true })
    expect(render([{ id: "zzz", notes }], "notes")).toContain("_Granola returned no meeting for this ID:_\n\nNo meeting matches these IDs. Check the active workspace.")
    expect(render([{ id: "zzz", notes: readNotes("") }], "notes")).toContain("_Granola returned no notes for this meeting ID.")
  })

  it("keeps only text from a reply without a meeting, never wrapper attributes", () => {
    const notes = readNotes(`<meetings_data connected_user_email="someone@example.test" count="0"><not_found_hint>Nothing found.</not_found_hint></meetings_data>`)
    expect(notes.blocks).toEqual([{ body: "Nothing found." }])
    const bare = readNotes(`<meetings_data connected_user_email="someone@example.test" count="0">No meetings.</meetings_data>`)
    expect(bare.blocks).toEqual([{ body: "No meetings." }])
    expect(render([{ id: "zzz", notes: bare }], "notes")).not.toContain("someone@example.test")
  })

  it("drops links that are not plain https", () => {
    for (const url of ["http://notes.example.test/d/1", "javascript:alert(1)", "https://user:secret@notes.example.test/d/1", "https://a b"]) {
      expect(readNotes(`<meeting id="1" url="${url}"/>`).url, url).toBeUndefined()
    }
  })
})

describe("the document", () => {
  const transcript = (lines: string[], end: Transcript["end"] = { kind: "complete" }): Transcript => ({ lines, end })

  it("starts with front matter and the fixed untrusted-content note, then one section per meeting in order", () => {
    const markdown = render([
      { id: "m-1", notes: readNotes(NOTES), transcript: transcript(["Ada: Hello.", "Lin: Hi."]) },
      { id: "m-2", transcript: { lines: ["Ada: Second."], end: { kind: "complete" }, title: "From the transcript" } },
    ])
    expect(frontMatter(markdown).split("\n")).toEqual([
      "source: Granola",
      'retrieved_at: "2026-10-30T14:05:09.000Z"',
      "content: both",
      "meetings:",
      '  - id: "m-1"',
      '    title: "Weekly & planning sync"',
      '    url: "https://notes.example.test/d/m-1"',
      '  - id: "m-2"',
      '    title: "From the transcript"',
    ])
    const body = markdown.slice(markdown.indexOf("\n---\n") + 5)
    expect(body.startsWith(`\n# Granola meeting notes and transcripts\n\n${UNTRUSTED_NOTE}\n\n## Weekly & planning sync\n\n- Meeting ID: \`m-1\`\n- Link: <https://notes.example.test/d/m-1>`)).toBe(true)
    expect(body.indexOf("## Weekly & planning sync")).toBeLessThan(body.indexOf("## From the transcript"))
    expect(body).toContain("### Transcript\n\nAda: Hello.\n\nLin: Hi.\n\n## From the transcript")
    expect(markdown.endsWith("Ada: Second.\n")).toBe(true)
  })

  it("keeps hostile titles and IDs from breaking the front matter or headings", () => {
    const notes = readNotes(`<meeting id="x" title="Evil&#10;---&#10;source: &quot;fake&quot;\\"/>`)
    const markdown = render([{ id: 'id"with`tick\nand line', notes }], "notes")
    const front = frontMatter(markdown)
    expect(front).toContain('  - id: "id\\"with`tick and line"')
    expect(front).toContain('    title: "Evil --- source: \\"fake\\"\\\\"')
    expect(markdown.match(/^---$/gm)).toHaveLength(2)
    expect(markdown).toContain('## Evil --- source: "fake"\\')
    expect(markdown).toContain('- Meeting ID: `` id"with`tick and line ``')
  })

  it.each([
    [{ kind: "unavailable", reason: "transcript_pending" }, "_No transcript: Granola is still processing it; export again in a few minutes._"],
    [{ kind: "unavailable", reason: "meeting_not_found" }, "_No transcript: Granola returned no meeting for this ID._"],
    [{ kind: "unavailable", reason: "something_new" }, "_No transcript: something_new._"],
    [{ kind: "size-limit" }, "_Transcript not included: the export reached its 8 MB size limit."],
    [{ kind: "incomplete" }, "_The transcript stops here: Granola did not return the rest."],
    [{ kind: "complete" }, "_The transcript is empty._"],
  ] as const)("ends an empty transcript (%j) with a note", (end, note) => {
    expect(render([{ id: "m", transcript: transcript([], end) }], "transcript")).toContain(`### Transcript\n\n${note}`)
  })

  it("marks where a cut transcript stops", () => {
    const markdown = render([{ id: "m", transcript: transcript(["Ada: One."], { kind: "size-limit" }) }], "transcript")
    expect(markdown).toContain("Ada: One.\n\n_The transcript stops here: the export reached its 8 MB size limit. Export this meeting on its own to get the rest._")
  })
})
