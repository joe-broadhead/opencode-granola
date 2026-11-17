// Granola's free (Basic) plan lets MCP see only the last 30 days of meetings. A listing whose cursor or since is older
// than that would walk through the hidden stretch and lose its meetings with no sign; instead it answers a
// window-truncated gap, once per read, and restarts where the plan's history begins. Built from the review of #26, whose
// test (a cursor 45 days old, meetings 40, 35 and 20 days ago) showed the loss in v0.0.4, and its re-review (a later
// page of the same read, two minutes on, and a plan that changed after probe).
import { describe, expect, it } from "vitest"
import { encodeBoundCursor } from "@we-the-rebel-alliance/source-contract/cursor"
import { resultProblems, type EventsListResult } from "@we-the-rebel-alliance/source-contract/events"
import { accountPlan } from "../src/events/granola.js"
import { PLAN_TTL_MS, UNWINDOWED_PLANS, VISIBLE_MS, granolaProbe, listEvents, recordPlan, recordedPlan } from "../src/events/index.js"
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
    const probe = (plan: string, input: Record<string, unknown> = {}) => granolaProbe(granola(plan).read, input, (who, named) => recordPlan(who, named, NOW))

    expect(recordedPlan(account, NOW)).toBeUndefined()
    expect((await read(PAID_PLAN)).gap).toEqual({ reason: "window-truncated", since: at(45) })
    // The probe answer itself is unchanged: no plan in it.
    expect(await probe(PAID_PLAN)).toEqual({ source: "granola", account, owner: { id: `mailto:${account}`, label: account }, scopes: ["personal", "public"], trust: "untrusted" })
    expect(recordedPlan(account, NOW)).toBe(PAID_PLAN)
    expect((await read(PAID_PLAN)).gap).toBeUndefined()

    await probe(FREE_PLAN)
    expect(recordedPlan(account, NOW)).toBe(FREE_PLAN)
    expect((await read(FREE_PLAN)).gap).toEqual({ reason: "window-truncated", since: at(45) })

    const silent = { read: async () => ({ content: [{ type: "text", text: JSON.stringify({ email: account }) }] }) as never }
    await granolaProbe(silent.read, {}, (who, named) => recordPlan(who, named, NOW))
    expect(recordedPlan(account, NOW)).toBeUndefined()
    // A probe for another account than the one asked records the signed-in account's plan, and refuses.
    await expect(probe(PAID_PLAN, { account: "someone@example.test" })).rejects.toThrow("ACCOUNT_MISMATCH")
    expect(recordedPlan(account, NOW)).toBe(PAID_PLAN)
  })
})

describe("a read that answered its gap, as the clock moves", () => {
  // Two meetings just inside the 29-day gap line, and page size 1: the re-review's case.
  const at = (offset: number) => new Date(NOW - VISIBLE_MS + offset).toISOString()
  const edge = [
    { ...meeting("edge-a", 0), at: at(60_000) },
    { ...meeting("edge-b", 0), at: at(90_000) },
    meeting("new-10", 10),
  ]
  const page = (input: Record<string, unknown>, now: number, plan: string | undefined = FREE_PLAN) =>
    listEvents(syntheticGranola({ meetings: edge, plan: FREE_PLAN, now }).read, { account: EMAIL, limit: 1, ...input }, now, () => plan)

  it("a later page from its cursor answers no second gap and skips no meeting Granola still shows", async () => {
    const first = await page({ cursor: cursorAt(45) }, NOW)
    expect(first.gap).toEqual({ reason: "window-truncated", since: new Date(NOW - 45 * DAY).toISOString() })
    expect([ids(first), first.more]).toEqual([["edge-a"], true])
    for (const later of [120_000, 3_600_000, 20 * 3_600_000]) {
      const second = await page({ cursor: first.cursor }, NOW + later)
      expect(second.gap).toBeUndefined()
      expect(ids(second)).toEqual(["edge-b"])
      const third = await page({ cursor: second.cursor }, NOW + later + 60_000)
      expect([third.gap, ids(third)]).toEqual([undefined, ["new-10"]])
    }
  })

  it("answers a new gap only when its cursor has fallen out of Granola's whole 30 days", async () => {
    const first = await page({ cursor: cursorAt(45) }, NOW)
    const late = NOW + DAY + 120_000
    const stalled = await page({ cursor: first.cursor }, late)
    expect(stalled.gap).toEqual({ reason: "window-truncated", since: at(60_000) })
    expect(ids(stalled)).toEqual(["new-10"])
  })

  it("drops the gap line once the read is a day past it: then the usual 29-day line applies again", async () => {
    const first = await page({ cursor: cursorAt(45), limit: 50 }, NOW)
    expect(ids(first)).toEqual(["edge-a", "edge-b", "new-10"])
    // The cursor is new-10's, 10 days back: well past the line, so a read 20 days later is held to 29 days again.
    const later = await page({ cursor: first.cursor, limit: 50 }, NOW + 19.5 * DAY)
    expect(later.gap?.reason).toBe("window-truncated")
  })

  it("a paid plan's cursor carries no gap line, and never gaps as the clock moves", async () => {
    const ALL = Array.from({ length: 6 }, (_, k) => meeting(`p-${k}`, 360 - k * 60))
    let cursor = cursorAt(400)
    const seen: string[] = []
    for (let k = 0; k < 20; k++) {
      const now = NOW + k * 3_600_000
      const result = await listEvents(syntheticGranola({ meetings: ALL, now }).read, { account: EMAIL, cursor, limit: 1 }, now, () => PAID_PLAN)
      expect(result.gap).toBeUndefined()
      seen.push(...ids(result))
      cursor = result.cursor
      if (!result.more) break
    }
    expect(seen).toEqual(ALL.map((entry) => entry.id))
  })
})

describe("a plan that changes after probe", () => {
  const ALL = [meeting("old-40", 40), meeting("new-20", 20)]
  const account = "ttl-test@example.test"
  const cursor = encodeBoundCursor({ ...BINDING, account }, { a: account, t: NOW - 45 * DAY, i: "" })
  const read = (now: number) => listEvents(syntheticGranola({ meetings: ALL, plan: FREE_PLAN, now: NOW, email: account }).read, { account, cursor, limit: 50 }, now)

  it("a recorded plan holds for a day: after that a paid record counts as none, so a downgraded account answers the gap", async () => {
    expect(PLAN_TTL_MS).toBe(DAY)
    recordPlan(account, "plus", NOW - DAY - 1)
    expect(recordedPlan(account, NOW)).toBeUndefined()
    const page = await read(NOW)
    expect(page.gap).toEqual({ reason: "window-truncated", since: at(45) })
    expect(ids(page)).toEqual(["new-20"])
  })

  it("within the day, a paid record is trusted: a downgrade that recent, with a cursor 29 days behind, is the one case without a gap (README, Known limits)", async () => {
    recordPlan(account, "plus", NOW - DAY + 60_000)
    expect(recordedPlan(account, NOW)).toBe("plus")
    const page = await read(NOW)
    expect(page.gap).toBeUndefined()
    expect(ids(page)).toEqual(["new-20"])
  })

  it("a free record while the account is now paid answers a gap it did not need, which only makes a consumer resync", async () => {
    recordPlan(account, FREE_PLAN, NOW)
    const paid = await listEvents(syntheticGranola({ meetings: ALL, now: NOW, email: account }).read, { account, cursor, limit: 50 }, NOW)
    expect(paid.gap?.reason).toBe("window-truncated")
    expect(ids(paid)).toEqual(["new-20"])
  })

  it("a record from the future, as after a clock change, counts as none", () => {
    recordPlan(account, "plus", NOW + 60_000)
    expect(recordedPlan(account, NOW)).toBeUndefined()
  })
})

describe("the gap line's edges", () => {
  const ALL = [meeting("a", 29.5), meeting("b", 28)]
  const page = (input: Record<string, unknown>) => listEvents(syntheticGranola({ meetings: ALL, plan: FREE_PLAN, now: NOW }).read, { account: EMAIL, limit: 50, ...input }, NOW, () => FREE_PLAN)

  it("29 days less a millisecond is inside, more a millisecond is a gap; since with any offset is read as its instant", async () => {
    const cursor = (t: number) => encodeBoundCursor(BINDING, { a: EMAIL, t, i: "" })
    expect((await page({ cursor: cursor(NOW - VISIBLE_MS + 1) })).gap).toBeUndefined()
    const outside = await page({ cursor: cursor(NOW - VISIBLE_MS - 1) })
    expect(outside.gap?.reason).toBe("window-truncated")
    expect(ids(outside)).toEqual(["b"])
    for (const since of ["2026-10-19T00:00:00+14:00", "2026-10-18T00:00:00-12:00", "2026-10-19"]) {
      const instant = Date.parse(since.length === 10 ? `${since}T00:00:00Z` : since)
      const result = await page({ since })
      expect(resultProblems(result)).toEqual([])
      expect(result.gap).toEqual(instant < NOW - VISIBLE_MS ? { reason: "window-truncated", since: new Date(instant).toISOString() } : undefined)
    }
  })
})
