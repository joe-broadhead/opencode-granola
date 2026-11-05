import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * Every code the plugin raises is in its documented errors table, and every documented code is raised: the model's
 * and setup's codes in docs/configuration.md, and the tools RPC's codes for scripts in docs/scripting.md.
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

/** Backticked codes in the first column of the tables in a doc's `## Errors` section, up to the next `## `. */
function documented(doc: string): string[] {
  const section = /^## Errors\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(read(doc))?.[1] ?? ""
  return [...section.matchAll(/^\| ([^|]+) \|/gm)].flatMap((row) => [...row[1]!.matchAll(/`([A-Z][A-Z_]+)`/g)].map((code) => code[1]!))
}

const sorted = (codes: Iterable<string>) => [...new Set(codes)].sort()

describe("error tables", () => {
  it("document exactly the codes the plugin raises to the model and at setup", () => {
    const raised = sources(SRC).flatMap((file) => [...readFileSync(file, "utf8").matchAll(/\bcode: "([A-Z][A-Z_]+)"/g)].map((match) => match[1]!))
    // Node's own errno codes, such as EEXIST, are matched in the export's file writer; they are not the plugin's.
    const plugin = raised.filter((code) => !/^E[A-Z]+$/.test(code))
    expect(plugin.length).toBeGreaterThan(10)
    expect(sorted(documented("docs/configuration.md"))).toEqual(sorted(plugin))
  })

  it("document exactly the codes the tools RPC gives scripts", () => {
    const block = /const NEXT_STEPS[^{]*\{([\s\S]*?)\n\}/.exec(read("src/host/tools-rpc.ts"))?.[1] ?? ""
    const raised = [...block.matchAll(/^\s+([A-Z][A-Z_]+):/gm)].map((match) => match[1]!)
    expect(raised.length).toBeGreaterThan(5)
    expect(sorted(documented("docs/scripting.md"))).toEqual(sorted(raised))
  })
})
