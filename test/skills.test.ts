import { readFileSync, readdirSync } from "node:fs"
import { relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { STATUS_COMMAND } from "../src/commands.js"
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

/** Parameter names the skills name in backticks, from Granola's live schemas: `folder_id` on search_meetings and list_meetings. */
const PARAMETERS = ["folder_id"]

/** Backticked snake_case names, which the skills use for tool names and the parameters above. */
function toolNames(markdown: string): string[] {
  return [...markdown.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((match) => match[1]!).filter((name) => !PARAMETERS.includes(name))
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

  it("list every known write and both plugin tools in the granola skill", () => {
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
