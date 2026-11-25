import assert from "node:assert/strict"
import { test } from "node:test"
import { handlersFor } from "../src/handlers/index.ts"
import { manifest, packageName } from "../src/manifest.ts"
import { testRuntime } from "./support/runtime.ts"

test("the package and the manifest name one plugin", () => {
  assert.equal(packageName, "@we-the-rebel-alliance/granola-plugin")
  assert.equal(manifest.plugin.name, "granola")
  assert.equal(manifest.plugin.vendor.domain, "granola.ai")
  assert.deepEqual(manifest.plugin.host, { opencode: ">=2.4.1 <2.5.0", tested: ["2.4.1"] })
  assert.ok(manifest.plugin.summary.length <= 400, `the namespace line is ${manifest.plugin.summary.length} characters`)
  assert.equal(manifest.plugin.summary.includes("\n"), false)
})

test("methods classify every callable, including every reachable pass-through MCP tool", () => {
  const methods = manifest.methods
  const names = Object.keys(methods)
  assert.equal(names.length, 24)
  const classes: Record<string, string[]> = {}
  for (const [name, item] of Object.entries(methods)) {
    const bucket = classes[item.class] ?? []
    bucket.push(name)
    classes[item.class] = bucket
  }
  assert.equal(classes["read"]?.length, 13)
  assert.equal(classes["write"]?.length, 7)
  assert.equal(classes["send"]?.length, 1)
  assert.equal(classes["share"]?.length, 1)
  assert.equal(classes["delete"]?.length, 1)
  assert.equal(classes["export"]?.length, 1)
  assert.equal(classes["admin"], undefined)
  assert.equal(names.includes("mcp:sign_out"), false, "sign_out stays out: the plugin removes it and it is not a contract method")
  assert.equal(methods["mcp:add_note_to_folder"]?.class, "share")
  assert.equal(methods["mcp:remove_note_from_folder"]?.class, "delete")
  assert.equal(methods["mcp:give_feedback"]?.class, "send")
  assert.equal(methods["mcp:get_meeting_transcript"]?.effect, "ask")
  assert.equal(methods["mcp:search_transcripts"]?.effect, "ask")
  assert.equal(methods["export_markdown"]?.accounts, "optional")
  assert.equal(methods["status"]?.accounts, "none")
  assert.equal(methods["events_list"]?.accounts, "optional")
  assert.equal(methods["probe"]?.accounts, "optional")
  for (const [name, item] of Object.entries(methods)) {
    if (!name.startsWith("mcp:")) assert.equal(item.pinned, undefined, `${name} is not pinned`)
  }
})

test("the handler table and the manifest describe the same non-MCP methods", () => {
  const { runtime } = testRuntime()
  const handlers = Object.keys(handlersFor(runtime)).sort()
  const declared = Object.keys(manifest.methods)
    .filter((name) => !name.startsWith("mcp:"))
    .sort()
  assert.deepEqual(handlers, declared)
})

test("two sources share one service and one read", () => {
  assert.equal(manifest.sources.length, 2)
  const events = manifest.sources[0]
  const snapshot = manifest.sources[1]
  assert.equal(events?.id, "granola.meetings")
  assert.equal(events?.kind, "events")
  assert.equal(snapshot?.id, "granola.meetings.list")
  assert.equal(snapshot?.kind, "snapshot")
  assert.equal(events?.service?.id, snapshot?.service?.id)
  assert.equal(events?.method, "events_list")
  assert.deepEqual(events?.input, { source: "granola" })
  assert.deepEqual(snapshot?.input, { source: "granola", list: "meetings" })
  assert.deepEqual(events?.operations, ["get_account_info", "search_meetings", "get_meetings"])
  assert.deepEqual(events?.urlHosts, ["notes.granola.ai"])
  assert.equal(events?.private, true)
  assert.equal(events?.cost?.class, "free")
  assert.equal(events?.maxBytes, 65536)
})

test("the plugin performs no write a nudge could honestly announce", () => {
  assert.deepEqual(manifest.events, {})
  assert.deepEqual(manifest.actions, [])
})
