import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"
import type { Plugin } from "@opencode/plugin"
import { readSkills, registerSkills } from "../src/skills.ts"

const roots: string[] = []
after(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tree(skills: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "granola-skills-"))
  roots.push(root)
  for (const [directory, text] of Object.entries(skills)) {
    mkdirSync(join(root, directory))
    writeFileSync(join(root, directory, "SKILL.md"), text)
  }
  return root
}

test("reads every skills/<name>/SKILL.md from the package root", () => {
  assert.deepEqual(
    readSkills().map((skill) => skill.id),
    ["granola", "granola-meeting-brief"],
  )
})

test("parses folded and literal block descriptions from the front matter", () => {
  const skills = readSkills(
    tree({
      granola: "---\nname: granola\ndescription: >\n  Read meetings and notes.\n  Keep the account in mind.\n---\nbody",
      "granola-meeting-brief": "---\nname: granola-meeting-brief\ndescription: |\n  First line.\n  Second line.\n---\nbody",
    }),
  )
  assert.deepEqual(
    skills.map((skill) => [skill.id, skill.description]),
    [
      ["granola", "Read meetings and notes. Keep the account in mind.\n"],
      ["granola-meeting-brief", "First line.\nSecond line.\n"],
    ],
  )
})

test("registers each skill under its directory name, with the parsed front matter and body", async () => {
  const skills = readSkills()
  const added: { id: string; name: string; description?: string; path: string; content: string }[] = []
  const ctx = {
    skill: {
      transform: async (callback: (editor: { add: (skill: (typeof added)[number]) => void }) => void) => {
        callback({ add: (skill) => void added.push(skill) })
        return { dispose: async () => {} }
      },
    },
  } as unknown as Plugin.Context
  await registerSkills(ctx, skills)
  assert.deepEqual(
    added.map((skill) => skill.id),
    ["granola", "granola-meeting-brief"],
  )
  for (const [index, skill] of skills.entries()) {
    const item = added[index]
    assert.ok(item !== undefined)
    assert.equal(item.name, skill.name)
    assert.equal(item.description, skill.description)
    assert.equal(item.path, skill.path)
    assert.equal(item.content, skill.content)
  }
})

for (const [label, files] of [
  ["a name that differs from the directory", { granola: "---\nname: other\ndescription: d\n---\nbody" }],
  ["no description", { granola: "---\nname: granola\n---\nbody" }],
  ["a block marker with no text", { granola: "---\nname: granola\ndescription: >\n---\nbody" }],
  ["a literal block marker as the description", { granola: "---\nname: granola\ndescription: '>'\n---\nbody" }],
  ["no front matter", { granola: "# Granola" }],
  ["an empty body", { granola: "---\nname: granola\ndescription: d\n---\n" }],
] as const) {
  test(`refuses a skill with ${label}, with a contract code and a next step`, () => {
    assert.throws(
      () => readSkills(tree(files)),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.match(error.message, /^SCHEMA_VIOLATION: /)
        assert.match(error.message, /Next step: /)
        return true
      },
    )
  })
}
