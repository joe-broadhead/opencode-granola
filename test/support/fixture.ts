/**
 * Builds `fixtures/conformance.json` from the handlers over the synthetic Granola server.
 *
 * The fixture records what the plugin answers for two aliases, so the conformance kit can replay it: two pages, an
 * empty page, an unknown source, a cursor another account may not use, a probe, the list snapshot and status. Every
 * value comes from running the real handler, so the recording cannot drift from the code.
 */
import { resolveAccount } from "@we-the-rebel-alliance/plugin-contract/accounts"
import { manifest, packageName } from "../../src/manifest.ts"
import { NOW, SINCE } from "./granola.ts"
import { ALIASES, profiles, refusal, runHandler, testRuntime } from "./runtime.ts"

export async function buildFixture(): Promise<Record<string, unknown>> {
  const { runtime } = testRuntime()
  const workProbe = await runHandler(runtime, "probe", { source: "granola", account: "work" }, "work")
  await runHandler(runtime, "probe", { source: "granola", account: "personal" }, "personal")

  const workPage = (await runHandler(runtime, "events_list", { source: "granola", account: "work", since: SINCE }, "work")) as { cursor: string }
  const personalPage = await runHandler(runtime, "events_list", { source: "granola", account: "personal", since: SINCE }, "personal")
  const emptyPage = await runHandler(runtime, "events_list", { source: "granola", account: "work", since: new Date(NOW - 3_600_000).toISOString() }, "work")
  const snapshot = await runHandler(runtime, "events_list", { source: "granola", account: "work", list: "meetings" }, "work")
  const status = await runHandler(runtime, "status", {}, "default")

  const cursorRefusal = await refusal(() => runHandler(runtime, "events_list", { source: "granola", account: "personal", cursor: workPage.cursor }, "personal"))
  const sourceRefusal = await refusal(() => runHandler(runtime, "events_list", { source: "other", account: "work" }, "work"))

  const plan = profiles()
  const required = resolveAccount(plan, {})
  const unknown = resolveAccount(plan, { account: "nobodyhere" })

  return {
    plugin: packageName,
    accounts: {
      real: false,
      aliases: [...ALIASES],
      required: { method: "events_list", code: required.ok ? "resolved" : required.code },
      unknown: { method: "events_list", account: "nobodyhere", code: unknown.ok ? "resolved" : unknown.code },
      cursors: [{ method: "events_list", account: "work", other: "personal", code: "CURSOR_INVALID" }],
    },
    sources: {
      "granola.meetings": {
        cases: [
          { name: "a work page", input: { source: "granola", account: "work", since: SINCE }, expect: "page", answer: workPage },
          { name: "a personal page", input: { source: "granola", account: "personal", since: SINCE }, expect: "page", answer: personalPage },
          { name: "an empty window", input: { source: "granola", account: "work", since: new Date(NOW - 3_600_000).toISOString() }, expect: "empty", answer: emptyPage },
          {
            name: "another account's cursor is refused",
            input: { source: "granola", account: "personal", cursor: workPage.cursor },
            expect: "CURSOR_INVALID",
            refuses: cursorRefusal,
          },
          { name: "an unknown source is refused", input: { source: "other", account: "work" }, expect: "SOURCE_UNKNOWN", refuses: sourceRefusal },
        ],
        probe: { input: { source: "granola", account: "work" }, answer: workProbe },
      },
      "granola.meetings.list": {
        snapshot: { input: { source: "granola", account: "work", list: "meetings" }, answer: snapshot },
        probe: { input: { source: "granola", account: "work" }, answer: workProbe },
      },
    },
    events: { emitted: [], status },
    rpc: { inputs: { export_markdown: { meeting_ids: ["m-01"], content: "notes" } } },
    namespace: manifest.plugin.summary,
  }
}
