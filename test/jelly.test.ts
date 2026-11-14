import { describe, expect, it } from "vitest"
import { HIDDEN_TOOLS, PLUGIN_READS, PLUGIN_TOOLS, READ_TOOLS, SERVER, WRITE_TOOLS, toolID } from "../src/known-tools.js"
import { defaultRules } from "../src/permissions.js"
import { ACCESS_VALUES, parseOptions } from "../src/options.js"
import { type Declaration, type DeclaredTool, declarationProblems, docProblems, effectFromRules, readPackage } from "./support/jelly-kit.js"
import { ACCESS_CHOICES, settingChoices, type PluginSetting, settingsProblems, settingValueIssue } from "./support/jelly-settings.js"

/**
 * The `jelly` section of package.json, which Jelly reads without loading the plugin. Jelly's agents have no base
 * "allow everything" rule, so this plugin's own default rules never reach them; Jelly writes each declared "ask" or
 * "deny" as that tool's default instead. The shared kit checks the declaration against Jelly's plugin authors'
 * standard; the tests below add what only Granola declares.
 */

const ROOT = new URL("../", import.meta.url)
const pkg = readPackage(ROOT)
const jelly = pkg.jelly as Declaration & { rpc: unknown[]; views: unknown[]; contributes: { homeFeeds: unknown[]; homeWidgets: unknown[]; workKinds: unknown[]; settings: PluginSetting[] }; tools: DeclaredTool[] }
const { settings } = jelly.contributes

describe("the jelly declaration", () => {
  it("follows the plugin authors' standard, with the effects the plugin's own default rules give", () => {
    expect(declarationProblems(ROOT, { effectOf: effectFromRules(defaultRules()) })).toEqual([])
  })

  it("declares every known read and the plugin's own read as read-only, and every write, the hidden sign_out and the plugin's export as not", () => {
    const known = new Map<string, boolean>([
      ...[...READ_TOOLS, ...PLUGIN_READS].map((name): [string, boolean] => [toolID(name), true]),
      ...[...WRITE_TOOLS, ...HIDDEN_TOOLS, ...PLUGIN_TOOLS].map((name): [string, boolean] => [toolID(name), false]),
    ])
    const declared = new Map(jelly.tools.map((tool) => [tool.permission, tool.readOnly]))
    expect([...declared.keys()].sort()).toEqual([...known.keys()].sort())
    for (const [permission, readOnly] of known) expect(declared.get(permission), permission).toBe(readOnly)
  })

  it("notes on the hidden sign_out how to sign out instead", () => {
    const signOut = jelly.tools.find((tool) => tool.permission === toolID("sign_out")) as DeclaredTool & { note?: string }
    expect(signOut.note).toContain("opencode mcp logout granola")
  })

  it("declares the granola server's sign-in", () => {
    expect(jelly.signIns).toEqual([{ id: "granola", label: "Granola", server: SERVER }])
  })

  it("declares the flat access option with Jelly's own words for its three values, and no RPC methods, views or other contributions", () => {
    expect(jelly.rpc).toEqual([])
    expect(jelly.views).toEqual([])
    expect(jelly.contributes).toEqual({
      homeFeeds: [],
      homeWidgets: [],
      workKinds: [],
      settings: [
        {
          key: "access",
          label: "Access",
          type: "string",
          description: "How much the plugin's tools may do. Generates default rules for agents with a base allow rule.",
          choices: ACCESS_CHOICES,
          default: "all",
        },
      ],
    })
  })

  it("follows Jelly's rules for a declared setting", () => {
    expect(settingsProblems(settings)).toEqual([])
  })

  it("offers only access values the options parser takes, its default included, and the parser refuses any other", () => {
    const access = settings.find((setting) => setting.key === "access")!
    const values = (settingChoices(access) ?? []).map((choice) => choice.value)
    expect(values).toEqual([...ACCESS_VALUES])
    for (const value of values) expect<string>(parseOptions({ access: value }).access).toBe(value)
    expect<string>(parseOptions({}).access).toBe(access.default as string)
    expect(settingValueIssue(access, "write")).not.toBeNull()
    expect(() => parseOptions({ access: "write" })).toThrow("Plugin option access")
  })
})

describe("docs/jelly.md", () => {
  it("follows the plugin authors' standard", () => {
    expect(docProblems(ROOT)).toEqual([])
  })
})
