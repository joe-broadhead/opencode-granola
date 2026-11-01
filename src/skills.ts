import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Skill, type Plugin } from "@opencode/plugin"
import { GranolaError, skillsInvalid } from "./errors.js"

export interface BundledSkill {
  readonly name: string
  readonly description: string
  readonly path: string
  readonly content: string
}

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Reads skills/<name>/SKILL.md, whose front matter names the skill after its directory. */
export function readSkills(root: string = fileURLToPath(new URL("../skills/", import.meta.url))): BundledSkill[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort()
    .map((directory) => {
      const path = join(root, directory, "SKILL.md")
      const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(readFileSync(path, "utf8"))
      const field = (key: string) => match?.[1]!.split(/\r?\n/).find((line) => line.startsWith(`${key}:`))?.slice(key.length + 1).trim()
      const name = field("name")
      const description = field("description")
      const content = match?.[2]!.trim()
      if (name !== directory || !KEBAB.test(directory) || !description || !content) {
        throw new GranolaError(skillsInvalid(`skills/${directory}/SKILL.md`))
      }
      return { name, description, path, content }
    })
}

/** Files are read before the transform, so replays do no disk I/O. */
export async function registerSkills(ctx: { readonly skill: Pick<Plugin.Context["skill"], "transform"> }, skills: readonly BundledSkill[] = readSkills()): Promise<void> {
  await ctx.skill.transform((editor) => {
    for (const skill of skills) {
      editor.add({
        id: Skill.ID.make(skill.name),
        name: Skill.Name.make(skill.name),
        description: skill.description,
        path: Skill.Info.fields.path.make(skill.path),
        content: skill.content,
      })
    }
  })
}
