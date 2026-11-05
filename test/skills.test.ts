import { readFileSync, readdirSync } from "node:fs"
import { relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { STATUS_COMMAND } from "../src/commands.js"
import { EXPORT_INPUT } from "../src/export/index.js"
import { HIDDEN_TOOLS, PLUGIN_TOOLS, READ_TOOLS, WRITE_TOOLS } from "../src/known-tools.js"
import { readSkills, registerSkills } from "../src/skills.js"
import { fakeHost } from "./fakes.js"

const root = fileURLToPath(new URL("../skills/", import.meta.url))
const NAMES = ["granola", "granola-meeting-brief"]
const skills = readSkills()
const text = (name: string) => readFileSync(new URL(`../skills/${name}/SKILL.md`, import.meta.url), "utf8")

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(`${directory}/${entry.name}`) : [`${directory}/${entry.name}`])
}

/** Each known tool's input parameters, from Granola's live schemas (reviewed 2026-11-05) and the plugin's export. */
const LIVE_PARAMETERS: Readonly<Record<string, readonly string[]>> = {
  get_account_info: [],
  list_meeting_folders: ["limit", "offset"],
  list_meetings: ["limit", "cursor", "time_range", "from_date", "to_date", "updated_after", "folder_id", "workspace_only", "involvement", "max_participants"],
  search_meetings: ["cursor", "folder_id", "workspace_only", "keywords", "max_participants", "participant", "limit", "attended_only", "include_shared", "from_date", "to_date", "updated_after"],
  get_meetings: ["meeting_ids", "note_ids", "max_participants", "attachments"],
  get_meeting_transcript: ["meeting_ids", "note_ids", "meeting_id", "note_id", "offset", "max_chars", "include_timestamps", "offsets", "chunk_ids", "transcript_version"],
  query_granola_meetings: ["query", "document_ids", "note_ids"],
  get_meeting_attachment: ["meeting_id", "note_id", "attachment_id", "attachment_ids", "offset", "limit"],
  list_templates: [],
  search_transcripts: ["keywords", "meeting_ids", "cursor", "limit", "from_date", "to_date", "participant", "attendee_emails", "attendee_domains"],
  create_folder: ["title", "description", "visibility"],
  update_folder: ["folder_id", "title", "description"],
  add_note_to_folder: ["note_id", "folder_id"],
  remove_note_from_folder: ["note_id", "folder_id"],
  update_private_notes: ["meeting_id", "note_id", "operations"],
  generate_summary: ["meeting_id", "note_id", "template_id"],
  give_feedback: ["message", "category", "tool_name", "severity"],
  export_markdown: Object.keys(EXPORT_INPUT.properties),
}

/** Result fields the skills may name, from Granola's live results. */
const RESULT_FIELDS = ["next_cursor", "next_offset", "read_chunk_ids", "sign_out_url"]

const PARAMETERS = new Set(Object.values(LIVE_PARAMETERS).flat())

/** Backticked snake_case names that are not parameters or result fields: the skills use them for tool names. */
function toolNames(markdown: string): string[] {
  return [...markdown.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)]
    .map((match) => match[1]!)
    .filter((name) => !PARAMETERS.has(name) && !RESULT_FIELDS.includes(name))
}

/** Call shapes such as `search_transcripts({ meeting_ids, keywords: [...] })`, with the keys they pass. */
function calls(markdown: string): { tool: string; keys: string[] }[] {
  return [...markdown.matchAll(/\b([a-z]+(?:_[a-z]+)+)\(\{([^}]*)\}/g)].map((match) => ({
    tool: match[1]!,
    keys: [...match[2]!.matchAll(/(?:^|,)\s*([a-z_]+)\s*(?=[:,]|$)/g)].map((key) => key[1]!),
  }))
}

describe("bundled skills", () => {
  it("ship exactly the two hand-written skills and nothing else", () => {
    expect(files(root).map((file) => relative(root, file)).sort()).toEqual(NAMES.map((name) => `${name}/SKILL.md`).sort())
  })

  it("load and register under kebab-case ids", async () => {
    expect(skills.map((skill) => skill.name)).toEqual(NAMES)
    const host = fakeHost()
    await registerSkills(host.ctx, skills)
    expect([...host.skills.keys()]).toEqual(NAMES)
    for (const skill of skills) {
      expect(skill.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      expect(host.skills.get(skill.name)).toMatchObject({ name: skill.name, description: skill.description, content: skill.content })
    }
  })

  it.each(NAMES)("%s has a front matter of one-line name and description", (name) => {
    const front = /^---\n([\s\S]*?)\n---\n/.exec(text(name))?.[1]
    expect(front?.split("\n").map((line) => line.split(":")[0])).toEqual(["name", "description"])
    const description = skills.find((skill) => skill.name === name)!.description
    expect(description).not.toMatch(/^[>|]/)
    expect(description.length).toBeGreaterThan(40)
    expect(description.length).toBeLessThanOrEqual(300)
  })

  it("name only Granola tools this plugin knows, never a hidden one", () => {
    const known: readonly string[] = [...READ_TOOLS, ...WRITE_TOOLS, ...PLUGIN_TOOLS]
    for (const name of NAMES) {
      const named = toolNames(text(name))
      expect(named.length).toBeGreaterThan(0)
      expect(named.filter((tool) => !known.includes(tool)), name).toEqual([])
      for (const hidden of HIDDEN_TOOLS) expect(text(name)).not.toContain(hidden)
    }
  })

  it("cover exactly the known tools in the live parameter table", () => {
    expect(Object.keys(LIVE_PARAMETERS).sort()).toEqual([...READ_TOOLS, ...WRITE_TOOLS, ...PLUGIN_TOOLS].sort())
  })

  it("pass each tool only parameters its live schema has", () => {
    for (const name of NAMES) {
      for (const call of calls(text(name))) {
        expect(LIVE_PARAMETERS[call.tool], `${name}: ${call.tool}`).toBeDefined()
        expect(call.keys.filter((key) => !LIVE_PARAMETERS[call.tool]!.includes(key)), `${name}: ${call.tool}`).toEqual([])
      }
    }
  })

  it("scope query_granola_meetings with document_ids, because it ignores meeting_ids without an error", () => {
    for (const name of NAMES) {
      if (!text(name).includes("query_granola_meetings")) continue
      expect(text(name), name).toContain("`document_ids`")
    }
  })

  it("list every known write and the plugin's export in the granola skill", () => {
    for (const tool of [...WRITE_TOOLS, ...PLUGIN_TOOLS]) expect(text("granola")).toContain(`\`${tool}\``)
  })

  it("give both sign-in paths and the plugin's status command", () => {
    const granola = text("granola")
    for (const step of ["`/connect`", "`opencode mcp auth granola`", "`opencode mcp logout granola`", `\`/${STATUS_COMMAND}\``]) {
      expect(granola).toContain(step)
    }
  })

  it("refer to each other by their real ids", () => {
    for (const name of NAMES) {
      const referenced = [...text(name).matchAll(/`(granola(?:-[a-z]+)+)`/g)].map((match) => match[1]!)
      expect(referenced.filter((skill) => !NAMES.includes(skill)), name).toEqual([])
    }
    expect(text("granola")).toContain("`granola-meeting-brief`")
    expect(text("granola-meeting-brief")).toContain("`granola`")
  })
})
