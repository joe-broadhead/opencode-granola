import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { TESTED_HOSTS } from "../src/hosts.js"
import { ACCESS_VALUES, type Access } from "../src/options.js"
import { defaultRules } from "../src/permissions.js"

/**
 * The docs state what the code does: the default block for each `access` value, generated from `defaultRules()`, and the
 * tested releases, which come from `TESTED_HOSTS`. A release added to the list, or a tool added to the rules, cannot
 * leave a stale sentence behind.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url))
const raw = (file: string) => readFileSync(`${ROOT}${file}`, "utf8")
const text = (file: string) => raw(file).replace(/\s+/g, " ")

/** The JSON of the first fenced block after a pattern's match, parsed. */
function block(body: string, pattern: RegExp): unknown {
  const found = pattern.exec(body)?.[1] ?? ""
  return JSON.parse(found)
}

describe("the default rules block", () => {
  it("the configuration guide prints the block for every access value, in full", () => {
    for (const access of ACCESS_VALUES) {
      const printed = block(raw("docs/configuration.md"), new RegExp(`\`access: "${access}"\`[\\s\\S]*?\\n\\n\`\`\`json\\n([\\s\\S]*?)\\n\`\`\``))
      expect({ access, printed }).toEqual({ access, printed: defaultRules(access) })
    }
  })

  it("the README prints the all block in full, generated from defaultRules()", () => {
    const printed = block(raw("README.md"), /## Permissions[\s\S]*?generated from[\s\S]*?```json\n([\s\S]*?)\n```/)
    expect(printed).toEqual(defaultRules("all"))
  })

  it("the namespace rule covers a tool no list names yet, for every value", () => {
    const effect = (access: Access) => defaultRules(access)[0]
    expect(effect("all")).toEqual({ action: "granola_*", resource: "*", effect: "allow" })
    expect(effect("ask-changes")).toEqual({ action: "granola_*", resource: "*", effect: "ask" })
    expect(effect("read-only")).toEqual({ action: "granola_*", resource: "*", effect: "deny" })
  })

  it("the README opens Permissions with what every-tool-allowed means here, and the two one-line restrictions", () => {
    const permissions = /## Permissions([\s\S]*?)## Configure/.exec(raw("README.md"))?.[1] ?? ""
    expect(permissions).toContain("**Every tool is allowed by default.**")
    expect(permissions).toContain("export Markdown into the export folder")
    for (const value of ['| `"all"` (the default) |', '| `"ask-changes"` |', '| `"read-only"` |']) expect(permissions).toContain(value)
    expect(text("SECURITY.md")).toContain('"access": "ask-changes"')
    expect(text("SECURITY.md")).toContain('"access": "read-only"')
  })

  it("the export folder is named as outside the project, with the external_directory rule", () => {
    for (const file of ["README.md", "docs/configuration.md", "docs/scripting.md", "SECURITY.md"]) {
      expect({ file, named: text(file).includes("external_directory") }).toEqual({ file, named: true })
    }
    expect(text("docs/configuration.md")).toContain('{ "action": "external_directory", "resource": "/home/someone/Granola/scheduled/*", "effect": "allow" }')
  })
})

describe("tested hosts", () => {
  const UNRELEASED = /## \[Unreleased\]([\s\S]*?)(?=\n## |$)/.exec(raw("CHANGELOG.md"))?.[1] ?? ""
  const SOURCES: [string, string][] = [
    ["README.md", raw("README.md")],
    ["AGENTS.md", raw("AGENTS.md")],
    ["SECURITY.md", raw("SECURITY.md")],
    ["docs/configuration.md", raw("docs/configuration.md")],
    ["CHANGELOG.md (Unreleased)", UNRELEASED],
  ]

  it.each(SOURCES)("%s names exactly TESTED_HOSTS wherever it says what is tested", (file, body) => {
    // The sentence that says something is tested, so a version list in the next sentence cannot leak in.
    const mentions = body
      .split("\n")
      .flatMap((line) => line.split(/\.\s+/))
      .filter((sentence) => /\btested\b/i.test(sentence))
      // The supported range is not a tested release: drop a backticked `>=a.b.c <d.e.f` span before reading versions.
      .map((sentence) => sentence.replace(/`[^`]*>=[^`]*`/g, ""))
      .map((sentence) => [...sentence.matchAll(/\b\d+\.\d+\.\d+\b/g)].map((version) => version[0]!))
      .filter((versions) => versions.length > 0)
    for (const versions of mentions) expect({ file, versions: [...new Set(versions)].sort() }).toEqual({ file, versions: [...TESTED_HOSTS].sort() })
  })

  it("the README's Requirements line names every tested release", () => {
    const requirements = /## Requirements([\s\S]*?)## /i.exec(raw("README.md"))?.[1] ?? ""
    const named = [...requirements.matchAll(/\b\d+\.\d+\.\d+\b/g)].map((match) => match[0]).filter((version) => version !== "2.3.0")
    expect([...new Set(named)].sort()).toEqual([...TESTED_HOSTS].sort())
  })

  // A release inside the range that ships later is the untested example, so it must be one that never ships.
  it("the untested example is 2.2.99, and no doc names a future release as tested", () => {
    const all = SOURCES.map(([, body]) => body).join("\n")
    expect(all).toContain("2.2.99")
    expect(all).not.toMatch(/\b2\.2\.(?:7|8|9[0-8])\b(?!\d)/)
  })
})
