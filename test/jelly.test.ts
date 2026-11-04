import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { PLUGIN_TOOLS, READ_TOOLS, SERVER, WRITE_TOOLS, toolID } from "../src/known-tools.js"
import { DEFAULT_RULES } from "../src/permissions.js"

/**
 * The `jelly` section of package.json, which Jelly reads without loading the plugin. Jelly's agents have no base
 * "allow everything" rule, so this plugin's own default rules never reach them; Jelly writes each declared "ask" or
 * "deny" as that tool's default instead. So each declared effect must be the one these rules give the tool after a
 * base allow, and the declared skills must be the ones the package ships.
 */

type Tool = { name: string; permission: string; effect: string; readOnly: boolean }
const jelly = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).jelly as {
  title: string
  tools: Tool[]
  skills: string[]
  rpc: unknown[]
  views: unknown[]
  signIns: unknown[]
  contributes: Record<string, unknown[]>
}
const rules: readonly { action: string; resource: string; effect: string }[] = [{ action: "*", resource: "*", effect: "allow" }, ...DEFAULT_RULES]
const wildcard = (pattern: string) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")}$`)
const effectOf = (action: string) => [...rules].reverse().find((rule) => wildcard(rule.action).test(action) && rule.resource === "*")?.effect

describe("the jelly declaration", () => {
  it("gives each tool the effect the plugin's own default rules give it", () => {
    expect(jelly.tools.length).toBeGreaterThan(0)
    for (const tool of jelly.tools) expect(effectOf(tool.permission), tool.permission).toBe(tool.effect)
  })

  it("names each tool once, as the engine names its permission (namespace.tool for namespace_tool)", () => {
    const names = jelly.tools.map((tool) => tool.name)
    expect(new Set(names).size).toBe(names.length)
    for (const tool of jelly.tools) expect(tool.name.replaceAll(".", "_"), tool.name).toBe(tool.permission)
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

  it("declares no RPC methods, views or contributions, and no keys a released Jelly does not read", () => {
    expect(jelly.rpc).toEqual([])
    expect(jelly.views).toEqual([])
    expect(jelly.contributes).toEqual({ homeFeeds: [], homeWidgets: [], workKinds: [], settings: [] })
    expect(Object.keys(jelly).sort()).toEqual(["contributes", "rpc", "signIns", "skills", "title", "tools", "views"])
  })

  it("names every skill the package ships", () => {
    expect([...jelly.skills].sort()).toEqual(readdirSync(new URL("../skills", import.meta.url)).sort())
  })
})
