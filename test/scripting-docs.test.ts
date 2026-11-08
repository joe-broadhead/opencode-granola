// docs/scripting.md and the README's scripting lines are the contract a script author copies. Every example must use a
// method this plugin registers, carry the location header and the strict envelope, and name only fields that method
// takes, so a doc example cannot drift from the code. The MCP tools' input schemas come from Granola's server at run
// time, so their fields are described by `describe`; the export's schema is the plugin's own and is checked here.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { EXPORT_INPUT } from "../src/export/index.js"
import { METHODS, TOOLS_RPC_ID } from "../src/host/tools-rpc.js"

const ROOT = fileURLToPath(new URL("../", import.meta.url))
const FILES = ["docs/scripting.md", "README.md"]
const METHODS_BY_NAME = new Map(METHODS.map((method) => [method.name, method]))
// The export is the plugin's own method, appended in setup where it has the plugin's context and export folder.
const OWN_METHODS = ["export_markdown"]

interface Example {
  readonly file: string
  readonly line: number
  readonly method: string
  readonly body: unknown
  readonly statement: string
}

/** Every `opencode api post /api/rpc/…` call in a file, as its method name and its parsed body. */
function calls(text: string, file: string): Example[] {
  const out: Example[] = []
  for (const match of text.matchAll(/opencode api post \/api\/rpc\/([A-Za-z0-9.]+)\/([A-Za-z0-9_]+)/g)) {
    const start = match.index!
    // A statement runs to the end of its fenced block or the next blank line.
    const rest = text.slice(start)
    const end = rest.search(/\n\s*\n|\n```/)
    const statement = (end === -1 ? rest : rest.slice(0, end)).trim()
    out.push({ file, line: text.slice(0, start).split("\n").length, method: match[2]!, body: bodyOf(statement), statement })
  }
  return out
}

/** The `-d '{…}'` body of a statement, by matching braces. */
function bodyOf(statement: string): unknown {
  const at = statement.indexOf("-d '{")
  if (at === -1) return undefined
  let depth = 0
  let inString = false
  for (let index = at + 4; index < statement.length; index++) {
    const char = statement[index]
    if (inString) {
      if (char === "\\") index++
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === "{") depth++
    else if (char === "}") {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(statement.slice(at + 4, index + 1))
        } catch {
          return undefined
        }
      }
    }
  }
  return undefined
}

const examples = FILES.flatMap((file) => calls(readFileSync(join(ROOT, file), "utf8"), file))

describe("the scripting examples", () => {
  it("has examples to check", () => {
    expect(examples.length).toBeGreaterThan(2)
  })

  it.each(examples)("$file:$line calls $method with this plugin's RPC id and a real method", (example) => {
    expect(example.statement).toContain("/api/rpc/granola.meetings.tools/")
    expect(TOOLS_RPC_ID).toBe("granola.meetings.tools")
    expect(example.method === "describe" || OWN_METHODS.includes(example.method) || METHODS_BY_NAME.has(example.method)).toBe(true)
  })

  it.each(examples)("$file:$line sends the location header", (example) => {
    expect(example.statement).toContain('-H "x-opencode-directory:$PWD"')
  })

  it.each(examples)("$file:$line sends the strict envelope", (example) => {
    const envelope = (example.body as { input?: Record<string, unknown> } | undefined)?.input
    expect(envelope).toBeDefined()
    if (example.method === "describe") {
      expect(Object.keys(envelope!).filter((key) => !["sessionID", "input"].includes(key))).toEqual([])
      return
    }
    expect(Object.keys(envelope!).sort()).toEqual(["input", "sessionID"])
    expect(typeof envelope!["sessionID"]).toBe("string")
    expect(typeof envelope!["input"]).toBe("object")
  })

  it.each(examples.filter((example) => example.method === "export_markdown"))("$file:$line names only fields the export takes", (example) => {
    const input = ((example.body as { input?: { input?: unknown } } | undefined)?.input?.input ?? {}) as Record<string, unknown>
    const properties = Object.keys(EXPORT_INPUT.properties)
    for (const key of Object.keys(input)) expect({ key, known: properties.includes(key) }).toEqual({ key, known: true })
    for (const key of EXPORT_INPUT.required) expect({ key, given: key in input }).toEqual({ key, given: true })
    expect(["notes", "transcript", "both"]).toContain(input.content)
  })
})
