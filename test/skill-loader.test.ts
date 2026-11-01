import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { readSkills, registerSkills } from "../src/skills.js"
import { fakeHost } from "./fakes.js"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tree(skills: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "granola-skills-"))
  roots.push(root)
  for (const [directory, text] of Object.entries(skills)) {
    mkdirSync(join(root, directory))
    writeFileSync(join(root, directory, "SKILL.md"), text)
  }
  mkdirSync(join(root, "not-a-skill"))
  return root
}

describe("skill loader", () => {
  it("reads every skills/<name>/SKILL.md and registers it under its name", async () => {
    const root = tree({
      granola: "---\nname: granola\ndescription: Use Granola meeting notes: search, read, query.\n---\n\n# Granola\nBody.\n",
      "granola-meeting-brief": "---\r\nname: granola-meeting-brief\r\ndescription: Brief a meeting.\r\n---\r\nBrief body.",
    })
    const skills = readSkills(root)
    expect(skills).toEqual([
      { name: "granola", description: "Use Granola meeting notes: search, read, query.", path: join(root, "granola", "SKILL.md"), content: "# Granola\nBody." },
      { name: "granola-meeting-brief", description: "Brief a meeting.", path: join(root, "granola-meeting-brief", "SKILL.md"), content: "Brief body." },
    ])
    const host = fakeHost()
    await registerSkills(host.ctx, skills)
    expect([...host.skills.keys()]).toEqual(["granola", "granola-meeting-brief"])
    expect(host.skills.get("granola")).toMatchObject({ name: "granola", description: skills[0]!.description, path: skills[0]!.path, content: "# Granola\nBody." })
  })

  it.each([
    ["a name that differs from the directory", { granola: "---\nname: other\ndescription: d\n---\nbody" }],
    ["no description", { granola: "---\nname: granola\n---\nbody" }],
    ["no front matter", { granola: "# Granola" }],
    ["a non-kebab-case directory", { Granola_Notes: "---\nname: Granola_Notes\ndescription: d\n---\nbody" }],
    ["an empty body", { granola: "---\nname: granola\ndescription: d\n---\n" }],
  ])("rejects a skill with %s", (_label, skills) => {
    expect(() => readSkills(tree(skills))).toThrow("SKILLS_INVALID: The bundled skill")
  })
})
