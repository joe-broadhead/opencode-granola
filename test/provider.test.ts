import assert from "node:assert/strict"
import { test } from "node:test"
import { SourceError } from "@we-the-rebel-alliance/plugin-contract/events"
import { PLAN_TTL_MS, ownerEmail } from "../src/provider/meetings.ts"
import { NOW } from "./support/granola.ts"
import { methodCall, testRuntime } from "./support/runtime.ts"

test("every call goes to the alias's own server", async () => {
  const { runtime, fake } = testRuntime()
  const result = await runtime.provider.call(methodCall("work"), "work", "get_account_info", {})
  assert.match(String(result.output), /ada@example\.test/)
  assert.deepEqual(fake.calls.map((call) => call.server), ["granola-work"])
})

test("a probe records the owner and plan per alias, and the plan expires", async () => {
  const { runtime } = testRuntime()
  assert.equal(runtime.provider.owner("work"), undefined)
  const read = await runtime.provider.probe(methodCall("work"), "work")
  assert.equal(read.owner.id, "mailto:ada@example.test")
  assert.deepEqual(read.scopes, ["personal", "public"])
  assert.equal(read.plan, "business")
  assert.equal(ownerEmail(read.owner), "ada@example.test")
  assert.deepEqual(runtime.provider.owner("work"), read.owner)
  assert.equal(runtime.provider.planOf("work", NOW, PLAN_TTL_MS), "business")
  assert.equal(runtime.provider.planOf("work", NOW + PLAN_TTL_MS + 1, PLAN_TTL_MS), undefined)
  assert.equal(runtime.provider.owner("personal"), undefined)
})

test("a second read that answers another email for the alias is ACCOUNT_MISMATCH", () => {
  const { runtime } = testRuntime()
  runtime.provider.recordEmail("work", "ada@example.test")
  assert.throws(
    () => runtime.provider.recordEmail("work", "someone.else@example.test"),
    (error: unknown) => error instanceof SourceError && error.code === "ACCOUNT_MISMATCH",
  )
})

test("a server that needs a sign-in answers NEEDS_SIGN_IN", async () => {
  const { runtime, fake } = testRuntime()
  fake.setState("personal", "needs_auth")
  const state = await runtime.provider.serverState("personal")
  assert.equal(state.state, "needs_sign_in")
  await assert.rejects(
    () => runtime.provider.call(methodCall("personal"), "personal", "get_meetings", { meeting_ids: ["p-01"] }),
    (error: unknown) => error instanceof SourceError && error.code === "NEEDS_SIGN_IN",
  )
})

test("a failed server answers an error state, not ready", async () => {
  const { runtime, fake } = testRuntime()
  fake.setState("work", "failed")
  const state = await runtime.provider.serverState("work")
  assert.equal(state.state, "error")
  assert.match(state.reason ?? "", /connection failed/)
})

test("has() asks the alias's own server", async () => {
  const { runtime } = testRuntime()
  assert.equal(await runtime.provider.has("work", "get_meetings"), true)
  assert.equal(await runtime.provider.has("work", "not_a_tool"), false)
})
