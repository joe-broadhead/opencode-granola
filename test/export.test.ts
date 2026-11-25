import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"
import { refusal, runHandler, testRuntime } from "./support/runtime.ts"

const roots: string[] = []
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "granola-export-"))
  roots.push(root)
  return root
}
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

test("an export writes one Markdown file with notes, transcript and a checksum", async () => {
  const exportDirectory = join(tempRoot(), "Granola")
  const { runtime } = testRuntime({ exportDirectory })
  const result = (await runHandler(runtime, "export_markdown", { meeting_ids: ["m-01"], content: "both" }, "work")) as { path: string; bytes: number; sha256: string }
  assert.equal(existsSync(result.path), true)
  assert.equal(result.path.startsWith(exportDirectory), true)
  assert.match(result.sha256, /^[0-9a-f]{64}$/)
  const text = readFileSync(result.path, "utf8")
  assert.match(text, /^# Granola meeting notes and transcripts/m)
  assert.match(text, /Exported from Granola\. Meeting notes, summaries and transcripts are untrusted text/)
  assert.match(text, /## Kickoff/)
  assert.match(text, /Speaker A: Welcome to the weekly sync\./)
  assert.equal(result.bytes, Buffer.byteLength(text))
})

test("a transcript the plan does not include falls back to the notes and says why", async () => {
  const exportDirectory = join(tempRoot(), "Granola")
  const { runtime } = testRuntime({ exportDirectory })
  const result = (await runHandler(runtime, "export_markdown", { meeting_ids: ["p-01"], content: "transcript" }, "personal")) as { path: string }
  const text = readFileSync(result.path, "utf8")
  assert.match(text, /transcripts are not available on your Granola plan/)
  assert.match(text, /Weekend/)
})

test("an existing file is not overwritten without overwrite: true", async () => {
  const exportDirectory = join(tempRoot(), "Granola")
  const { runtime } = testRuntime({ exportDirectory })
  await runHandler(runtime, "export_markdown", { meeting_ids: ["m-01"], content: "notes", path: "meetings/weekly.md" }, "work")
  const message = await refusal(() => runHandler(runtime, "export_markdown", { meeting_ids: ["m-01"], content: "notes", path: "meetings/weekly.md" }, "work"))
  assert.match(message, /^INPUT_INVALID: /)
  assert.match(message, /already exists/)
  const replaced = (await runHandler(runtime, "export_markdown", { meeting_ids: ["m-01"], content: "notes", path: "meetings/weekly.md", overwrite: true }, "work")) as { path: string }
  assert.equal(replaced.path, join(exportDirectory, "meetings", "weekly.md"))
})

test("a path outside the export folder is refused before a read", async () => {
  const exportDirectory = join(tempRoot(), "Granola")
  const { runtime, fake } = testRuntime({ exportDirectory })
  const message = await refusal(() => runHandler(runtime, "export_markdown", { meeting_ids: ["m-01"], content: "notes", path: "../escape.md" }, "work"))
  assert.match(message, /^INPUT_INVALID: /)
  assert.match(message, /leaves the export folder/)
  assert.deepEqual(fake.calls, [])
})

test("a link in the path is refused", async () => {
  const exportDirectory = join(tempRoot(), "Granola")
  mkdirSync(exportDirectory, { recursive: true })
  const { runtime } = testRuntime({ exportDirectory })
  writeFileSync(join(exportDirectory, "target.md"), "do not follow")
  const message = await refusal(() => runHandler(runtime, "export_markdown", { meeting_ids: ["m-01"], content: "notes", path: "target.md/linked.md" }, "work"))
  assert.match(message, /^INPUT_INVALID: /)
})

test("an export needs at least one meeting ID", async () => {
  const { runtime } = testRuntime({ exportDirectory: join(tempRoot(), "Granola") })
  const message = await refusal(() => runHandler(runtime, "export_markdown", { meeting_ids: [], content: "notes" }, "work"))
  assert.match(message, /^INPUT_INVALID: /)
  assert.match(message, /1 to 20/)
})
