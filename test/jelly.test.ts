import { describe, expect, it } from "vitest"
import { PLUGIN_TOOLS, READ_TOOLS, SERVER, WRITE_TOOLS, toolID } from "../src/known-tools.js"
import { defaultRules } from "../src/permissions.js"
import { type Declaration, type DeclaredTool, declarationProblems, docProblems, effectFromRules, readPackage } from "./support/jelly-kit.js"

/**
 * The `jelly` section of package.json, which Jelly reads without loading the plugin. Jelly's agents have no base
 * "allow everything" rule, so this plugin's own default rules never reach them; Jelly writes each declared "ask" or
 * "deny" as that tool's default instead. The shared kit checks the declaration against Jelly's plugin authors'
 * standard; the tests below add what only Granola declares.
 */

const ROOT = new URL("../", import.meta.url)
const pkg = readPackage(ROOT)
const jelly = pkg.jelly as Declaration & { rpc: unknown[]; views: unknown[]; contributes: Record<string, unknown[]>; tools: DeclaredTool[] }

describe("the jelly declaration", () => {
  it("follows the plugin authors' standard, with the effects the plugin's own default rules give", () => {
    expect(declarationProblems(ROOT, { effectOf: effectFromRules(defaultRules()) })).toEqual([])
  })

  it("declares every known read as read-only, and every write and the plugin's own tools as not", () => {
    const known = new Map<string, boolean>([
      ...READ_TOOLS.map((name): [string, boolean] => [toolID(name), true]),
      ...[...WRITE_TOOLS, ...PLUGIN_TOOLS].map((name): [string, boolean] => [toolID(name), false]),
    ])
    const declared = new Map(jelly.tools.map((tool) => [tool.permission, tool.readOnly]))
    expect([...declared.keys()].sort()).toEqual([...known.keys()].sort())
    for (const [permission, readOnly] of known) expect(declared.get(permission), permission).toBe(readOnly)
  })

  it("declares the granola server's sign-in", () => {
    expect(jelly.signIns).toEqual([{ id: "granola", label: "Granola", server: SERVER }])
  })

  it("declares no RPC methods, views or contributions", () => {
    expect(jelly.rpc).toEqual([])
    expect(jelly.views).toEqual([])
    expect(jelly.contributes).toEqual({ homeFeeds: [], homeWidgets: [], workKinds: [], settings: [] })
  })
})

describe("docs/jelly.md", () => {
  it("follows the plugin authors' standard", () => {
    expect(docProblems(ROOT)).toEqual([])
  })
})
