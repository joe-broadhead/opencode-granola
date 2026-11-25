import assert from "node:assert/strict"
import { test } from "node:test"
import { SourceError } from "@we-the-rebel-alliance/plugin-contract/events"
import { ACCOUNTS, EXPECTED, FREE_PLAN, NOW, PERSONAL_MEETINGS, SINCE, WORK_EMAIL, createFakeMCP } from "./support/granola.ts"
import { refusal, runHandler, testRuntime } from "./support/runtime.ts"

const events = (input: Record<string, unknown>, account: string, runtime: ReturnType<typeof testRuntime>["runtime"]) =>
  runHandler(runtime, "events_list", { source: "granola", ...input }, account) as Promise<{ source: string; account: string; owner: { id: string }; events: { external_id: string }[]; cursor: string; more: boolean; gap?: { reason: string }; asOf: string }>

test("a work page lists the attended, settled meetings oldest first", async () => {
  const { runtime } = testRuntime()
  const page = await events({ since: SINCE }, "work", runtime)
  assert.equal(page.source, "granola")
  assert.equal(page.account, "work")
  assert.equal(page.owner.id, `mailto:${WORK_EMAIL}`)
  assert.deepEqual(page.events.map((event) => event.external_id), EXPECTED)
  assert.equal(page.gap, undefined)
  assert.equal(page.more, false)
  assert.equal(page.asOf, new Date(NOW).toISOString())
})

test("the other alias reads its own meetings, under its own owner", async () => {
  const { runtime } = testRuntime()
  const page = await events({ since: SINCE }, "personal", runtime)
  assert.equal(page.account, "personal")
  assert.equal(page.owner.id, "mailto:ada.personal@example.test")
  assert.deepEqual(page.events.map((event) => event.external_id), ["p-01"])
  assert.equal(page.events.length, PERSONAL_MEETINGS.length)
})

test("an events read records the owner before it lists, so a page always names one", async () => {
  const { runtime, fake } = testRuntime()
  await events({ since: SINCE }, "work", runtime)
  assert.equal(fake.calls[0]?.tool, "get_account_info")
  assert.equal(fake.calls[0]?.server, "granola-work")
})

test("the free plan answers a window-truncated gap once and lists from inside the window", async () => {
  const fake = createFakeMCP(
    { work: { ...ACCOUNTS["work"]!, plan: FREE_PLAN }, personal: ACCOUNTS["personal"]! },
    { now: NOW },
  )
  const { runtime } = testRuntime({ fake })
  const page = await events({ since: SINCE }, "work", runtime)
  assert.equal(page.gap?.reason, "window-truncated")
  assert.equal(page.events.some((event) => event.external_id === "m-01"), false)
  assert.equal(page.events.some((event) => event.external_id === "m-05a"), true)
})

test("an empty window answers an empty page with a cursor, compactly", async () => {
  const { runtime } = testRuntime()
  const page = await events({ since: new Date(NOW - 3_600_000).toISOString() }, "work", runtime)
  assert.deepEqual(page.events, [])
  assert.equal(typeof page.cursor, "string")
  assert.equal(page.more, false)
})

test("a cursor issued for one alias is CURSOR_INVALID under another", async () => {
  const { runtime } = testRuntime()
  const work = await events({ since: SINCE }, "work", runtime)
  const message = await refusal(() => events({ cursor: work.cursor }, "personal", runtime))
  assert.match(message, /^CURSOR_INVALID: /)
  assert.match(message, /Next step: /)
})

test("two events at one timestamp across a page boundary are neither skipped nor repeated", async () => {
  const { runtime } = testRuntime()
  // m-05a and m-05b both start at 2026-10-12T08:00:00Z; m-06 follows on another week.
  const since = "2026-10-12T07:59:00.000Z"
  const first = await events({ since, limit: 1 }, "work", runtime)
  assert.deepEqual(first.events.map((event) => event.external_id), ["m-05a"])
  assert.equal(first.more, true)
  const second = await events({ cursor: first.cursor, limit: 1 }, "work", runtime)
  assert.deepEqual(second.events.map((event) => event.external_id), ["m-05b"], "the second event at the same timestamp is not skipped")
  const third = await events({ cursor: second.cursor, limit: 1 }, "work", runtime)
  assert.deepEqual(third.events.map((event) => event.external_id), ["m-06"], "the page after the shared timestamp continues in order")
  const ids = [...first.events, ...second.events, ...third.events].map((event) => event.external_id)
  assert.deepEqual(ids, ["m-05a", "m-05b", "m-06"], "no event is repeated")
})

test("an unknown source is refused before any read", async () => {
  const { runtime, fake } = testRuntime()
  const message = await refusal(() => runHandler(runtime, "events_list", { source: "other" }, "work"))
  assert.match(message, /^SOURCE_UNKNOWN: /)
  assert.deepEqual(fake.calls, [])
})

test("the list snapshot names recent meetings, newest first, and nothing private", async () => {
  const { runtime } = testRuntime()
  const answer = (await runHandler(runtime, "events_list", { source: "granola", list: "meetings" }, "work")) as { data: { items: { id: string; text: string }[]; editable: boolean }; asOf: string; trust: string }
  assert.equal(answer.trust, "untrusted")
  assert.equal(answer.data.editable, false)
  assert.deepEqual(answer.data.items.slice(0, 3).map((item) => item.id), ["m-08", "m-07", "m-06"])
  assert.equal(answer.data.items.some((item) => item.id === "m-06"), true, "a meeting inside the window is listed")
  assert.equal(JSON.stringify(answer).includes("Private notes"), false)
})

test("a snapshot read refuses events-only fields", async () => {
  const { runtime } = testRuntime()
  const message = await refusal(() => runHandler(runtime, "events_list", { source: "granola", list: "meetings", cursor: "x" }, "work"))
  assert.match(message, /^INPUT_INVALID: /)
})

test("probe reads the owner and scopes and no meeting content", async () => {
  const { runtime, fake } = testRuntime()
  const answer = (await runHandler(runtime, "probe", { source: "granola" }, "work")) as { source: string; account: string; owner: { id: string }; scopes: string[]; trust: string }
  assert.deepEqual(answer, {
    source: "granola",
    account: "work",
    owner: { id: `mailto:${WORK_EMAIL}`, label: WORK_EMAIL },
    scopes: ["personal", "public"],
    trust: "untrusted",
  })
  assert.deepEqual(fake.calls.map((call) => call.tool), ["get_account_info"])
})

test("status lists every alias, with its owner and its live server state", async () => {
  const { runtime } = testRuntime()
  await runHandler(runtime, "probe", {}, "work")
  await runHandler(runtime, "probe", {}, "personal")
  const status = (await runHandler(runtime, "status", {}, "default")) as { name: string; state: string; accounts: { alias: string; state: string; owner?: { id: string } }[]; unguardedAgents: string[]; nextStep: string | null; host: { range: string } }
  assert.equal(status.name, "granola")
  assert.equal(status.state, "ready")
  assert.equal(status.host.range, ">=2.4.1 <2.5.0")
  assert.deepEqual(status.accounts.map((account) => account.alias), ["work", "personal"])
  assert.deepEqual(status.accounts.map((account) => account.state), ["ready", "ready"])
  assert.deepEqual(status.accounts.map((account) => account.owner?.id), [`mailto:${WORK_EMAIL}`, "mailto:ada.personal@example.test"])
  assert.deepEqual(status.unguardedAgents, [])
  assert.equal(status.nextStep, null)
})

test("status says needs_sign_in when an alias needs a sign-in", async () => {
  const { runtime, fake } = testRuntime()
  fake.setState("personal", "needs_auth")
  const status = (await runHandler(runtime, "status", {}, "default")) as { state: string; accounts: { alias: string; state: string }[]; nextStep: string | null }
  assert.equal(status.state, "needs_sign_in")
  assert.equal(status.accounts.find((account) => account.alias === "personal")?.state, "needs_sign_in")
  assert.match(status.nextStep ?? "", /Sign in/)
})

test("an unreadable agent list is an error, never a false zero", async () => {
  const { runtime } = testRuntime()
  const status = (await runHandler(runtime, "status", {}, "default", { unguardedAgents: async () => ({ ok: false, error: "the host list failed" }) })) as { state: string; unguardedAgents: string[]; nextStep: string | null }
  assert.equal(status.state, "error")
  assert.deepEqual(status.unguardedAgents, [])
  assert.match(status.nextStep ?? "", /the host list failed/)
})

test("a method call refuses a cursor from another plugin", async () => {
  const { runtime } = testRuntime()
  const message = await refusal(() => runHandler(runtime, "events_list", { source: "granola", cursor: "not-a-cursor" }, "work"))
  assert.match(message, /^CURSOR_INVALID: /)
})

test("provider refusals keep the contract's form", async () => {
  const { runtime } = testRuntime()
  await assert.rejects(
    () => runHandler(runtime, "probe", { source: "other" }, "work"),
    (error: unknown) => error instanceof SourceError && error.code === "SOURCE_UNKNOWN",
  )
})
