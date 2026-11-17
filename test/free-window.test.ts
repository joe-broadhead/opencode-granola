// Granola's free (Basic) plan lets MCP see only the last 30 days of meetings. A listing whose cursor or since is older
// than that would walk through the hidden stretch and lose its meetings with no sign; instead it answers a
// window-truncated gap, once per read, and restarts where the plan's history begins. Built from the review of #26, whose
// test (a cursor 45 days old, meetings 40, 35 and 20 days ago) showed the loss in v0.0.4.
import { describe, expect, it } from "vitest"
import { encodeBoundCursor } from "@we-the-rebel-alliance/source-contract/cursor"
import { resultProblems, type EventsListResult } from "@we-the-rebel-alliance/source-contract/events"
import { accountPlan } from "../src/events/granola.js"
import { UNWINDOWED_PLANS, VISIBLE_MS, granolaProbe, listEvents, recordedPlan } from "../src/events/index.js"
import { EMAIL, FREE_PLAN, PAID_PLAN, syntheticGranola, type SyntheticMeeting } from "./synthetic-granola/meetings.js"

const DAY = 86_400_000
const NOW = Date.parse("2026-11-17T12:00:00Z")
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString()
const meeting = (id: string, daysAgo: number): SyntheticMeeting => ({
  id,
  title: `Meeting ${id}`,
  at: at(daysAgo),
  attended: true,
  participants: [{ name: "Ada Example", email: EMAIL }],
  summary: "Invented.",
})
const ALL = [meeting("old-40", 40), meeting("old-35", 35), meeting("new-20", 20), meeting("new-10", 10)]
const BINDING = { plugin: "granola", source: "granola", account: EMAIL }
const cursorAt = (daysAgo: number) => encodeBoundCursor(BINDING, { a: EMAIL, t: NOW - daysAgo * DAY, i: "" })
const ids = (page: EventsListResult) => page.events.map((event) => event.external_id)
const list = (plan: string | undefined, input: Record<string, unknown>) =>
  listEvents(syntheticGranola({ meetings: ALL, plan: plan ?? FREE_PLAN, now: NOW }).read, { account: EMAIL, limit: 50, ...input }, NOW, () => plan)

describe("Granola's free plan: a start older than its 30 days", () => {
  it("answers a window-truncated gap from the cursor's position, and lists from the window's start", async () => {
    const page = await list(FREE_PLAN, { cursor: cursorAt(45) })
    expect(page.gap).toEqual({ reason: "window-truncated", since: at(45) })
    expect(ids(page)).toEqual(["new-20", "new-10"])
    expect(resultProblems(page)).toEqual([])
  })

  it("answers the gap once per read: the next page, from the cursor it answered, carries none", async () => {
    const first = await list(FREE_PLAN, { cursor: cursorAt(45), limit: 1 })
    expect(first.gap).toEqual({ reason: "window-truncated", since: at(45) })
    expect([ids(first), first.more]).toEqual([["new-20"], true])
    const second = await list(FREE_PLAN, { cursor: first.cursor })
    expect(second.gap).toBeUndefined()
    expect(ids(second)).toEqual(["new-10"])
  })

  it("answers it for a first read from since, with since as given", async () => {
    const page = await list(FREE_PLAN, { since: at(45) })
    expect(page.gap).toEqual({ reason: "window-truncated", since: at(45) })
    expect(ids(page)).toEqual(["new-20", "new-10"])
  })

  it("answers no gap for a cursor or since inside the window", async () => {
    for (const input of [{ cursor: cursorAt(25) }, { since: at(25) }]) {
      const page = await list(FREE_PLAN, input)
      expect(page.gap).toBeUndefined()
      expect(ids(page)).toEqual(["new-20", "new-10"])
    }
  })

  it("reads a day inside the window, so a meeting at its edge is covered by the gap, never skipped silently", async () => {
    expect(VISIBLE_MS).toBe(29 * DAY)
    const page = await list(FREE_PLAN, { cursor: cursorAt(29.5) })
    expect(page.gap).toEqual({ reason: "window-truncated", since: at(29.5) })
  })

  it("with no plan recorded, or a plan it does not know, reads as the free plan: a needless gap only makes a consumer resync", async () => {
    for (const plan of [undefined, "trial", "basic"]) {
      const page = await list(plan, { cursor: cursorAt(45) })
      expect(page.gap).toEqual({ reason: "window-truncated", since: at(45) })
    }
  })

  it("on a paid plan, which has no window, lists everything after the cursor and answers no gap", async () => {
    expect([...UNWINDOWED_PLANS].sort()).toEqual(["business", "enterprise", "plus"])
    for (const plan of UNWINDOWED_PLANS) {
      const page = await list(plan, { cursor: cursorAt(45) })
      expect(page.gap).toBeUndefined()
      expect(ids(page)).toEqual(["old-40", "old-35", "new-20", "new-10"])
    }
  })
})

describe("probe records the plan per account, and events_list uses it", () => {
  it("reads mcp_plan from get_account_info: a string or an object's name, lowercase; nothing when it names none", () => {
    const content = (value: unknown) => ({ content: [{ type: "text", text: JSON.stringify(value) }] })
    expect(accountPlan(content({ email: EMAIL, mcp_plan: " Plus " }))).toBe("plus")
    expect(accountPlan({ output: { mcp_plan: { name: "Business" } } })).toBe("business")
    expect(accountPlan(content({ email: EMAIL }))).toBeUndefined()
    expect(accountPlan(content({ mcp_plan: "" }))).toBeUndefined()
    expect(accountPlan(content({ mcp_plan: "x".repeat(65) }))).toBeUndefined()
    expect(accountPlan({ content: "<connected_user_email>ada@example.test</connected_user_email>" })).toBeUndefined()
  })

  it("a paid plan probe read lifts the window for that account; a free one, or a later read naming none, sets it back", async () => {
    const account = "plan-test@example.test"
    const granola = (plan: string) => syntheticGranola({ meetings: ALL, plan, now: NOW, email: account })
    const cursor = encodeBoundCursor({ ...BINDING, account }, { a: account, t: NOW - 45 * DAY, i: "" })
    const read = (plan: string) => listEvents(granola(plan).read, { account, cursor, limit: 50 }, NOW)

    expect(recordedPlan(account)).toBeUndefined()
    expect((await read(PAID_PLAN)).gap).toEqual({ reason: "window-truncated", since: at(45) })
    // The probe answer itself is unchanged: no plan in it.
    expect(await granolaProbe(granola(PAID_PLAN).read, {})).toEqual({ source: "granola", account, owner: { id: `mailto:${account}`, label: account }, scopes: ["personal", "public"], trust: "untrusted" })
    expect(recordedPlan(account)).toBe(PAID_PLAN)
    expect((await read(PAID_PLAN)).gap).toBeUndefined()

    await granolaProbe(granola(FREE_PLAN).read, {})
    expect(recordedPlan(account)).toBe(FREE_PLAN)
    expect((await read(FREE_PLAN)).gap).toEqual({ reason: "window-truncated", since: at(45) })

    const silent = { read: async () => ({ content: [{ type: "text", text: JSON.stringify({ email: account }) }] }) as never }
    await granolaProbe(silent.read, {})
    expect(recordedPlan(account)).toBeUndefined()
    // A probe for another account than the one asked records the signed-in account's plan, and refuses.
    await expect(granolaProbe(granola(PAID_PLAN).read, { account: "someone@example.test" })).rejects.toThrow("ACCOUNT_MISMATCH")
    expect(recordedPlan(account)).toBe(PAID_PLAN)
  })
})
