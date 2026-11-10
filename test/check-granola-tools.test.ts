// The maintainer's drift check, scripts/check-granola-tools.mjs: it compares a saved tool list with the tables in
// src/known-tools.ts, names what changed, and exits 0 unless --strict finds drift. Each case writes its own list.
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { READ_TOOLS, WRITE_TOOLS } from "../src/known-tools.js"

const SCRIPT = new URL("../scripts/check-granola-tools.mjs", import.meta.url).pathname
const dir = mkdtempSync(join(tmpdir(), "granola-drift-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

let next = 0
/** Runs the script on a saved list. Strings are written as they are, so a bad file can be tested. */
function run(list: unknown, ...args: string[]) {
  const file = join(dir, `tools-${next++}.json`)
  writeFileSync(file, typeof list === "string" ? list : JSON.stringify(list))
  return spawnSync(process.execPath, [SCRIPT, file, ...args], { encoding: "utf8" })
}

/** The tools as the server lists them today: reads are read-only, writes are not, and the plugin's own tools are listed too. */
function liveList(): { name: string; annotations: { readOnlyHint: boolean; destructiveHint?: boolean } }[] {
  return [
    ...READ_TOOLS.map((name) => ({ name: `granola_${name}`, annotations: { readOnlyHint: true } })),
    ...WRITE_TOOLS.map((name) => ({ name: `granola_${name}`, annotations: { readOnlyHint: false, destructiveHint: true } })),
    { name: "granola_events_list", annotations: { readOnlyHint: true } },
    { name: "granola_export_markdown", annotations: { readOnlyHint: false } },
    { name: "granola_sign_out", annotations: { readOnlyHint: false } },
  ]
}

describe("npm run drift: scripts/check-granola-tools.mjs", () => {
  it("reports no drift when the list matches the tables, and the plugin's own tools are not drift", () => {
    const result = run({ tools: liveList() }, "--strict")
    expect(result.status).toBe(0)
    expect(result.stdout).toContain(`no drift: ${READ_TOOLS.length + WRITE_TOOLS.length + 3} tools match`)
  })

  it("names a tool the table does not classify, and only fails with --strict", () => {
    const tools = [...liveList(), { name: "granola_new_tool", annotations: { readOnlyHint: true } }]
    expect(run({ tools }).stdout).toContain("added, unclassified (1): new_tool")
    expect(run({ tools }).status).toBe(0)
    expect(run({ tools }, "--strict").status).toBe(1)
  })

  it("names a known tool the server no longer lists", () => {
    const tools = liveList().filter((tool) => tool.name !== "granola_get_meetings")
    const result = run({ tools })
    expect(result.stdout).toContain("removed (1): get_meetings")
    expect(result.status).toBe(0)
  })

  it("names a read the server now marks destructive, and a write it marks read-only", () => {
    const tools = liveList().map((tool) => {
      if (tool.name === "granola_get_meetings") return { ...tool, annotations: { readOnlyHint: true, destructiveHint: true } }
      if (tool.name === "granola_create_folder") return { ...tool, annotations: { readOnlyHint: true } }
      return tool
    })
    const result = run({ tools }, "--strict")
    expect(result.stdout).toContain("annotations disagree with the class (2): create_folder, get_meetings")
    expect(result.status).toBe(1)
  })

  it("accepts names without the prefix", () => {
    const tools = liveList().map((tool) => ({ ...tool, name: tool.name.replace("granola_", "") }))
    expect(run({ tools }, "--strict").status).toBe(0)
  })

  it("exits 2 for a missing list, a file that is not JSON, and an unknown option", () => {
    expect(spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" }).status).toBe(2)
    expect(run("{ not json").status).toBe(2)
    expect(run({ tools: [{ annotations: {} }] }).status).toBe(2)
    expect(run({ tools: [] }, "--verbose").status).toBe(2)
  })
})
