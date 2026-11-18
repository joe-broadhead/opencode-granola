// The source contract's conformance kit over the source this plugin declares in package.json's `sources`, run on the
// plugin's own events_list and probe methods against the synthetic Granola (test/synthetic-granola/meetings.ts: every
// meeting, name and address invented, in the shapes Granola's live tools answer with): no Granola call, no sign-in.
// The account is on Granola's free plan, which shows only the last 30 days, and the first listing starts before that,
// so the kit sees the window-truncated gap and checks it is answered once per read.
// The reads go through a fake of OpenCode's executor that asserts `granola_<tool>` on the kit's recording permission,
// as the host asserts it, so the kit sees exactly what each read asserts. The report is written to
// reports/conformance-report.json, for a release to attach; it holds no time or path, so every run writes the same bytes.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { declarationProblems, sourceConformance, type ConformanceReport, type PageCase, type SessionContext } from "@we-the-rebel-alliance/source-contract/conformance"
import { encodeBoundCursor, encodeCursor } from "@we-the-rebel-alliance/source-contract/cursor"
import { readInstalledDescriptor } from "@we-the-rebel-alliance/source-contract/descriptor"
import { SOURCES_SCHEMA, type Sources } from "@we-the-rebel-alliance/source-contract/schema"
import type { ToolCall } from "@we-the-rebel-alliance/source-contract/tools-rpc"
import { PACKAGE, SOURCE, SOURCE_ID, eventsMethod, probeMethod, type EventsContext } from "../src/events/index.js"
import { TOOLS_RPC_ID } from "../src/tools-rpc.js"
import { EMAIL, FREE_PLAN, MEETINGS, NOW, SINCE, syntheticGranola, type SyntheticMeeting } from "./synthetic-granola/meetings.js"

const root = fileURLToPath(new URL("..", import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name: string; version: string; sources: unknown; jelly: { tools: { name: string; readOnly: boolean }[] } }
/** The declaration as Memory's schema parses it, which is what the kit takes. */
const checked = SOURCES_SCHEMA.check(pkg.sources)
if (!checked.ok) throw new Error(`the sources declaration is invalid: ${checked.problems.join("; ")}`)
const sources: Sources = checked.value
const tools = pkg.jelly.tools.map((tool) => ({ id: tool.name.replace(/^granola\./, ""), readOnly: tool.readOnly }))

/** One more meeting, whose summary holds a password in a link: a secret the source must refuse for good. */
const SECRET: SyntheticMeeting = {
  id: "m-05c",
  title: "Staging handover",
  at: "2026-10-20T10:00:00Z",
  attended: true,
  participants: [{ name: "Ada Example", email: EMAIL }],
  summary: "The staging files are at https://pilot:Wq7rZp4xLm9@files.example.net/share",
}
const MEETINGS_WITH_SECRET = [...MEETINGS, SECRET]

/**
 * Why no single meeting can fail on its own, for the kit's `failed-holds-cursor` check: what the source reads answers
 * for the whole page or fails the whole call.
 */
const ATOMIC =
  "Granola's search_meetings and get_meetings answer for the whole page: a meeting get_meetings leaves out of a batch is read again alone, " +
  "and if it is still left out it is listed from search_meetings' own facts without its summary, a lasting answer rather than a retryable failure; " +
  "a failed read, a rate limit or an incomplete listing fails the whole call, so no single meeting fails on its own"

/**
 * Why the kit's `gap-and-cursor-expired` check cannot apply: it takes only CURSOR_EXPIRED or a gap with reason
 * `expired`, and this source answers neither on any plan. The free plan's lost history is a `window-truncated` gap,
 * which this run exercises (`gap-once-per-read`).
 */
const NO_EXPIRY =
  "A cursor holds its whole position, a meeting's start time and ID, bound to the plugin, source and account, with no state on Granola's side, " +
  "so it is never refused as expired and the source never answers CURSOR_EXPIRED or an expired gap: on a paid plan Granola hides no history, " +
  "and history the free plan's 30-day window hides is answered as a window-truncated gap, once per read, which gap-once-per-read checks here"

/** OpenCode's executors for Granola's reads, answering from the synthetic account; each asserts `granola_<tool>` first, as the host does. */
function context(permission: SessionContext["permission"]): EventsContext {
  const granola = syntheticGranola({ meetings: MEETINGS_WITH_SECRET, plan: FREE_PLAN })
  return {
    tool: {
      list: async () =>
        ["get_account_info", "search_meetings", "get_meetings"].map((name) => ({
          id: `granola_${name}`,
          execute: async (input: Record<string, unknown>) => {
            await permission.assert({ action: `granola_${name}`, resources: ["*"] } as never)
            return granola.read(name, input)
          },
        })) as never,
    },
    mcp: { list: async () => ({ data: [{ name: "granola", status: { status: "connected" } }] }) as never },
    permission: permission as never,
  }
}

const call = (): ToolCall => ({ sessionID: "ses_conformance", agent: "build", messageID: "msg_script", id: "script:conformance", signal: new AbortController().signal, progress: async () => {} })
const open: SessionContext = { account: EMAIL, permission: { assert: async () => {} } }
const list = (input: Record<string, unknown>, session: SessionContext = open) => eventsMethod(context(session.permission), () => NOW).run(input, call()) as Promise<Record<string, any>>

async function cases(): Promise<PageCase[]> {
  const first = (await list({ account: EMAIL, since: SINCE, limit: 2 }))["cursor"] as string
  const done = (await list({ account: EMAIL, since: SINCE, limit: 500 }))["cursor"] as string
  const bound = (binding: { plugin: string; source: string; account: string }) => encodeBoundCursor(binding, { a: binding.account, t: Date.parse(SINCE), i: "" })
  return [
    { name: "a first listing from before the free plan's 30 days: a window-truncated gap, then one meeting refused for a secret", input: { account: EMAIL, since: SINCE }, expect: "page" },
    { name: "the same, two at a time: the gap once, and not on the page its cursor names", input: { account: EMAIL, since: SINCE, limit: 2 }, expect: "page" },
    { name: "what came after the first two, inside the window: no gap", input: { account: EMAIL, cursor: first }, expect: "page" },
    { name: "the same, two at a time", input: { account: EMAIL, cursor: first, limit: 2 }, expect: "page" },
    { name: "nothing new since the last listing", input: { account: EMAIL, cursor: done }, expect: "empty" },
    { name: "a cursor without the account it reads", input: { cursor: first }, expect: { refuses: "INPUT_INVALID" } },
    { name: "a first listing that names no account", input: { since: SINCE }, expect: { refuses: "INPUT_INVALID" } },
    { name: "a cursor passed for another account", input: { account: "someone@example.test", cursor: first }, expect: { refuses: "ACCOUNT_MISMATCH" } },
    { name: "another source's cursor", input: { account: EMAIL, cursor: bound({ plugin: "granola", source: "gmail", account: EMAIL }) }, expect: { refuses: "CURSOR_INVALID" } },
    { name: "a cursor bound to another plugin", input: { account: EMAIL, cursor: bound({ plugin: "wisprflow", source: SOURCE, account: EMAIL }) }, expect: { refuses: "CURSOR_INVALID" } },
    { name: "an earlier version's unbound cursor", input: { account: EMAIL, cursor: encodeCursor(SOURCE, { a: "default", o: "0123456789abcdef", t: 0, i: "" }) }, expect: { refuses: "CURSOR_INVALID" } },
    { name: "a source this plugin does not have", input: { account: EMAIL, source: "transcripts" }, expect: { refuses: "SOURCE_UNKNOWN" } },
  ]
}

/**
 * The kit's checks that do not apply to this source, and why: a free source bills nothing (`billed-cost`), it declares
 * no `details`, no `scope.suggest` and no snapshot output (`details`, `suggest`, `output-schema`), it removes nothing
 * (`removals-are-final`), and it states why no meeting fails on its own and no cursor expires (`failed-holds-cursor`,
 * `gap-and-cursor-expired`, with ATOMIC and NO_EXPIRY). Every other check runs, `gap-once-per-read` on the free plan's gap.
 */
const NOT_APPLICABLE = ["billed-cost", "details", "failed-holds-cursor", "gap-and-cursor-expired", "output-schema", "removals-are-final", "suggest"]

const reports: ConformanceReport[] = []

describe("the source contract's conformance kit", () => {
  it("the declaration validates, as a consumer reads it from the installed package", () => {
    const installed = readInstalledDescriptor(root, { version: pkg.version })
    expect(installed.ok ? [] : installed.problems).toEqual([])
    expect(declarationProblems(pkg.sources, { tools })).toEqual([])
    expect(sources.rpc).toBe(TOOLS_RPC_ID)
    expect(pkg.name).toBe(PACKAGE)
    expect(sources.items.map((item) => [item.id, item.kind])).toEqual([
      [SOURCE_ID, "events"],
      ["granola.meetings.list", "snapshot"],
    ])
    expect(sources.items.find((item) => item.id === "granola.meetings.list")).toMatchObject({ output: "list", tool: "events_list" })
  })

  it("the descriptor and the read agree: the account is named, it is the email probe answers, and no read takes another", async () => {
    const source = sources.items.find((item) => item.id === SOURCE_ID)!
    expect(source.accounts).toEqual({ named: true })
    const probed = (await probeMethod(context(open.permission)).run({}, call())) as { account: string }
    expect(probed.account).toBe(EMAIL)
    expect(await list({ account: probed.account, since: SINCE, limit: 1 })).toMatchObject({ account: probed.account })
    // A consumer that fills "default", as for an unnamed source, or names no account, is refused.
    for (const input of [{ since: SINCE }, { account: "default", since: SINCE }]) await expect(list(input)).rejects.toThrow("INPUT_INVALID")
    await expect(probeMethod(context(open.permission)).run({ account: "default" }, call())).rejects.toThrow("ACCOUNT_MISMATCH")
  })

  it(`${SOURCE_ID} keeps the contract`, async () => {
    const source = sources.items.find((item) => item.id === SOURCE_ID)!
    const report = await sourceConformance({
      plugin: pkg.name,
      source,
      tools,
      calls: {
        list: (input, session) => list(input as Record<string, unknown>, session),
        probe: (input, session) => probeMethod(context(session.permission)).run(input, call()),
      },
      cases: await cases(),
      account: EMAIL,
      sources,
      describe: { id: TOOLS_RPC_ID },
      atomicPages: { reason: ATOMIC },
      noExpiry: { reason: NO_EXPIRY },
    })
    reports.push(report)
    expect(report.problems).toEqual([])
    // Every check that applies runs: the report is complete, and ok; the free plan's gap is checked.
    expect(report.checks.filter((check) => !check.ran && !check.notApplicable).map((check) => check.name)).toEqual([])
    expect(report.checks.find((check) => check.name === "gap-once-per-read")).toMatchObject({ ran: true, notApplicable: false })
    // Exactly these do not apply (NOT_APPLICABLE); the two this source states carry their reasons into the report.
    expect(report.checks.filter((check) => check.notApplicable).map((check) => check.name).sort()).toEqual(NOT_APPLICABLE)
    const reasons = Object.fromEntries(report.checks.filter((check) => check.reason !== undefined).map((check) => [check.name, check.reason]))
    expect(reasons).toMatchObject({ "failed-holds-cursor": ATOMIC, "gap-and-cursor-expired": NO_EXPIRY })
    expect(report.ok).toBe(true)
  })

  it("granola.meetings.list keeps the contract", async () => {
    const listed = sources.items.find((item) => item.id === "granola.meetings.list")!
    const report = await sourceConformance({
      plugin: pkg.name,
      source: listed,
      tools,
      calls: {
        snapshot: (input, session) => eventsMethod(context(session.permission), () => NOW).run(input, call()) as Promise<Record<string, unknown>>,
        probe: (input, session) => probeMethod(context(session.permission)).run(input, call()),
      },
      snapshotCases: [{ ...(listed.input ?? {}), account: EMAIL }],
      cases: [],
      account: EMAIL,
      sources,
      describe: { id: TOOLS_RPC_ID },
    })
    reports.push(report)
    expect(report.problems).toEqual([])
    expect(report.checks.filter((check) => !check.ran && !check.notApplicable).map((check) => check.name)).toEqual([])
    expect(report.ok).toBe(true)
    expect(report.incomplete).toBe(false)
  })

  it("writes the report a release attaches", () => {
    expect(reports.map((report) => report.source).sort()).toEqual([SOURCE_ID, "granola.meetings.list"].sort())
    const installed = readInstalledDescriptor(root, { version: pkg.version })
    const report = {
      contract: "@we-the-rebel-alliance/source-contract@0.2.0",
      plugin: pkg.name,
      version: pkg.version,
      descriptorHash: installed.ok ? installed.value.hash : null,
      ok: reports.every((entry) => entry.ok),
      sources: reports,
    }
    mkdirSync(join(root, "reports"), { recursive: true })
    writeFileSync(join(root, "reports", "conformance-report.json"), `${JSON.stringify(report, null, 2)}\n`)
  })
})
