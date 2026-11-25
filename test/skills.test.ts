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
  mkdirSync(join(root, "not-a-skill"))
  return root
}

test("reads every skills/<name>/SKILL.md from the package root", () => {
  assert.deepEqual(
    readSkills().map((skill) => skill.name),
    ["granola", "granola-meeting-brief"],
  )
})

test("registers each skill under its directory name, with the parsed front matter and body", async () => {
  const skills = readSkills()
  const added: { id: string; name: string; description?: string; path: string; content: string }[] = []
  const ctx = {
    transform: async (callback: (editor: { add: (skill: (typeof added)[number]) => void }) => void) => {
      callback({ add: (skill) => void added.push(skill) })
      return { dispose: async () => {} }
    },
  } as unknown as Pick<Plugin.Context["skill"], "transform">
  await registerSkills(ctx, skills)
  assert.deepEqual(
    added.map((skill) => skill.id),
    ["granola", "granola-meeting-brief"],
  )
  for (const [index, skill] of skills.entries()) {
    assert.equal(added[index]!.name, skill.name)
    assert.equal(added[index]!.description, skill.description)
    assert.equal(added[index]!.path, skill.path)
    assert.equal(added[index]!.content, skill.content)
  }
})

for (const [label, files] of [
  ["a name that differs from the directory", { granola: "---\nname: other\ndescription: d\n---\nbody" }],
  ["no description", { granola: "---\nname: granola\n---\nbody" }],
  ["no front matter", { granola: "# Granola" }],
  ["a non-kebab-case directory", { Granola_Notes: "---\nname: Granola_Notes\ndescription: d\n---\nbody" }],
  ["an empty body", { granola: "---\nname: granola\ndescription: d\n---\n" }],
] as const) {
  test(`refuses a skill with ${label}, with a contract code and a next step`, () => {
    assert.throws(
      () => readSkills(tree(files)),
      (error: unknown) => {
        assert.ok(error instanceof Error)
        assert.match(error.message, /^OPTIONS_INVALID: /)
        assert.match(error.message, /Next step: /)
        return true
      },
    )
  })
}
