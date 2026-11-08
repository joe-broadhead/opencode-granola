import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { PLUGIN_CODES, RPC_CODES } from "../src/errors.js"

/**
 * One typed code table, and the docs that must match it. A code the plugin raises is in `PLUGIN_CODES`; a code the tools
 * RPC gives a script is in `RPC_CODES`. The README's Troubleshooting table lists exactly the first, and
 * docs/scripting.md's refusal table exactly the second, so neither can drift in either direction.
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url))
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const TOOLS_RPC = join("host", "tools-rpc.ts")

function sources(directory: string, base = directory): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sources(path, base)
    return /\.tsx?$/.test(entry.name) && path.slice(base.length) !== TOOLS_RPC ? [path] : []
  })
}

/** Backticked codes in the first column of every table row in a section, up to the next `## `. */
function documented(doc: string, heading: string): string[] {
  const section = new RegExp(`^## ${heading}\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m").exec(read(doc))?.[1] ?? ""
  return [...section.matchAll(/^\| ([^|]+) \|/gm)].flatMap((row) => [...row[1]!.matchAll(/`([A-Z][A-Z_]+)`/g)].map((code) => code[1]!))
}

const sorted = (codes: Iterable<string>) => [...new Set(codes)].sort()

describe("error tables", () => {
  it("raises only codes the table names", () => {
    const raised = sources(SRC).flatMap((file) => {
      const text = readFileSync(file, "utf8")
      return [
        ...[...text.matchAll(/\bcode: "([A-Z][A-Z_]+)"/g)].map((match) => match[1]!),
        // A code that starts a message instead, as `CODE: what happened`.
        ...[...text.matchAll(/["'`]([A-Z][A-Z_]+): /g)].map((match) => match[1]!),
      ]
    })
    // Node's own errno codes, such as EEXIST, are matched in the export's file writer; they are not the plugin's.
    const plugin = raised.filter((code) => !/^E[A-Z]+$/.test(code))
    expect(plugin.length).toBeGreaterThan(10)
    expect(sorted(plugin).filter((code) => !(PLUGIN_CODES as readonly string[]).includes(code))).toEqual([])
  })

  it("the README's Troubleshooting table lists exactly the plugin's codes", () => {
    expect(sorted(documented("README.md", "Troubleshooting"))).toEqual(sorted(PLUGIN_CODES))
  })

  it("docs/scripting.md lists exactly the tools RPC's codes for scripts", () => {
    expect(sorted(documented("docs/scripting.md", "Errors"))).toEqual(sorted(RPC_CODES))
  })

  it("docs/configuration.md documents every plugin code, and no others", () => {
    expect(sorted(documented("docs/configuration.md", "Errors"))).toEqual(sorted(PLUGIN_CODES))
  })

  it("the tools RPC gives a script a code the model also gets, and the shared table names them", () => {
    const block = /const NEXT_STEPS[^{]*\{([\s\S]*?)\n\}/.exec(read("src/host/tools-rpc.ts"))?.[1] ?? ""
    const raised = [...block.matchAll(/^\s+([A-Z][A-Z_]+):/gm)].map((match) => match[1]!)
    expect(raised.length).toBeGreaterThan(5)
    expect(sorted(raised)).toEqual(sorted(RPC_CODES))
  })
})
