/**
 * The bundled skills: `skills/<name>/SKILL.md`, read from the package root and registered through `ctx.skill`.
 *
 * The contract's `register` wires doors 1–3 and does not register skills, so setup does it here, after the host gate
 * and the options. Files are read once, before the synchronous transform, so a replay does no disk I/O.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Skill, type Plugin } from "@opencode/plugin"

/** One bundled skill, as the transform adds it. */
export interface BundledSkill {
  readonly name: string
  readonly description: string
  readonly path: string
  readonly content: string
}

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const INVALID = (directory: string, problem: string) =>
  new Error(
    `OPTIONS_INVALID: The bundled skill skills/${directory}/SKILL.md ${problem}. Next step: give it a --- front matter with name: ${directory}, a one-line description, then a non-empty body.`,
  )

/** Reads every skills/<name>/SKILL.md under `root`, whose front matter names the skill after its directory. */
export function readSkills(root: string = fileURLToPath(new URL("../skills/", import.meta.url))): BundledSkill[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort()
    .map((directory) => {
      const path = join(root, directory, "SKILL.md")
      const text = readFileSync(path, "utf8")
      const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text)
      if (match === null) throw INVALID(directory, "has no --- front matter")
      if (!KEBAB.test(directory)) throw INVALID(directory, "is not a kebab-case directory")
      const field = (key: string) =>
        match[1]!
          .split(/\r?\n/)
          .find((line) => line.startsWith(`${key}:`))
          ?.slice(key.length + 1)
          .trim()
      const name = field("name")
      const description = field("description")
      const content = match[2]!.trim()
      if (name !== directory) throw INVALID(directory, `names ${name ?? "no skill"} instead of ${directory}`)
      if (description === undefined || description === "") throw INVALID(directory, "has no description")
      if (content === "") throw INVALID(directory, "has an empty body")
      return { name: directory, description, path, content }
    })
}

/** Adds every bundled skill to the host's skill list. The files were read before this synchronous transform. */
export async function registerSkills(
  skill: Pick<Plugin.Context["skill"], "transform">,
  skills: readonly BundledSkill[],
): Promise<void> {
  await skill.transform((editor) => {
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
