import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { eventHash } from "@we-the-rebel-alliance/plugin-contract/events"
import { redactText, redactValue } from "@we-the-rebel-alliance/plugin-contract/kit"
import { manifest, packageName, version } from "../src/manifest.ts"
import { refusal, runHandler, testRuntime } from "./support/runtime.ts"

interface Case {
  readonly name?: string
  readonly input?: Record<string, unknown>
  readonly expect?: string
  readonly refuses?: string
  readonly answer?: unknown
}

interface Fixture {
  readonly plugin: string
  readonly namespace: string
  readonly sources: Record<string, { cases?: Case[]; probe?: { input?: Record<string, unknown>; answer?: unknown }; snapshot?: { input?: Record<string, unknown>; answer?: unknown } }>
  readonly events: { status: unknown }
}

const fixture = JSON.parse(readFileSync(new URL("../fixtures/conformance.json", import.meta.url), "utf8")) as Fixture

const accountOf = (input: Record<string, unknown> | undefined): string => (typeof input?.["account"] === "string" ? input["account"] : "default")

/** The fixture is redacted; its event hashes were recomputed after redaction. Do the same to the live page. */
const redactedPage = (answer: unknown): unknown => {
  const redacted = redactValue(answer) as { events?: Record<string, unknown>[] } | undefined
  for (const event of redacted?.events ?? []) event["hash"] = eventHash(event as never)
  return redacted
}

test("the fixture names this package, this manifest and its namespace line", () => {
  assert.equal(fixture.plugin, packageName)
  assert.equal(fixture.namespace, manifest.plugin.summary)
})

test("every recorded events page is what the handler answers now", async () => {
  const { runtime } = testRuntime()
  const cases = fixture.sources["granola.meetings"]?.cases ?? []
  assert.ok(cases.length >= 5)
  for (const item of cases) {
    const input = item.input ?? {}
    const account = accountOf(input)
    if (typeof item.expect === "string" && !["page", "empty"].includes(item.expect)) {
      const message = await refusal(() => runHandler(runtime, "events_list", input, account))
      assert.equal(redactText(message), item.refuses, item.name)
      assert.match(message, new RegExp(`^${item.expect}: `), item.name)
      continue
    }
    const answer = await runHandler(runtime, "events_list", input, account)
    // The committed fixture is redacted by `plugin-kit record`; compare the live answer through the same redaction.
    assert.deepEqual(redactedPage(answer), item.answer, item.name)
  }
})

test("the recorded probe and list snapshot are what the handlers answer now", async () => {
  const { runtime } = testRuntime()
  const source = fixture.sources["granola.meetings"]
  assert.ok(source?.probe)
  const probeInput = source.probe.input ?? {}
  assert.deepEqual(redactValue(await runHandler(runtime, "probe", probeInput, accountOf(probeInput))), source.probe.answer)

  const list = fixture.sources["granola.meetings.list"]
  assert.ok(list?.snapshot)
  const snapshotInput = list.snapshot.input ?? {}
  assert.deepEqual(redactValue(await runHandler(runtime, "events_list", snapshotInput, accountOf(snapshotInput))), list.snapshot.answer)
})

test("the recorded status is what the handler answers now", async () => {
  const { runtime } = testRuntime()
  await runHandler(runtime, "probe", {}, "work")
  await runHandler(runtime, "probe", {}, "personal")
  const status = redactValue(await runHandler(runtime, "status", {}, "default"), ["events", "status"]) as { version: string }
  assert.deepEqual(status, fixture.events.status)
  assert.equal((status as { version: string }).version, version)
})
