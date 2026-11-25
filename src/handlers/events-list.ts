/**
 * `events_list`: the meetings source's one read (contract §7), and its `list` snapshot.
 *
 * The input parser, the page builder and the cursor codec come from the contract's `events` module. This handler
 * validates what only the plugin knows (the source and the `list` selector) and asks the provider.
 */
import { EVENTS_LIST_INPUT_SCHEMA, PAGE_SCHEMA, parseEventsListInput } from "@we-the-rebel-alliance/plugin-contract/events"
import type { JsonSchema } from "@we-the-rebel-alliance/plugin-contract/manifest"
import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import { LIST_SNAPSHOT_SCHEMA, refuseInput } from "./shared.ts"
import { PLAN_TTL_MS, SOURCE, listEvents, meetingsList, ownerEmail } from "../provider/meetings.ts"
import { sourceUnknown } from "../provider/errors.ts"
import type { HandlerRuntime } from "./index.ts"

/** The events page or, with `list`, the list snapshot; each source's answer is checked by the kit. */
const OUTPUT = { anyOf: [PAGE_SCHEMA, LIST_SNAPSHOT_SCHEMA] }

const base = EVENTS_LIST_INPUT_SCHEMA as { readonly properties: Readonly<Record<string, unknown>>; readonly [key: string]: unknown }

/** The contract's events input, plus the plugin's `list` selector for the snapshot. */
const INPUT: JsonSchema = {
  ...base,
  properties: {
    ...base.properties,
    list: { type: "string", enum: ["meetings"], description: "Answer recent meeting titles as a list snapshot instead of events." },
  },
}

/** The events fields a snapshot read does not take. */
const SNAPSHOT_ONLY = ["source", "list"] as const

/**
 * `events_list`: one account's page of meetings, oldest first, with a cursor bound to the alias, or the `list`
 * snapshot of recent meeting titles.
 */
export function eventsListHandler(runtime: HandlerRuntime): MethodHandler {
  return {
    description:
      "List Granola meetings as events, oldest first, with a cursor tied to the account. Pass the cursor a page returned to read what follows it. With list: meetings, answer the recent meeting titles as a list snapshot instead.",
    input: INPUT,
    output: OUTPUT,
    async run(input, call) {
      const { list, ...rest } = input
      if (list !== undefined) {
        if (list !== "meetings") refuseInput(["list must be meetings"])
        const extra = Object.keys(rest).filter((key) => !(SNAPSHOT_ONLY as readonly string[]).includes(key))
        if (extra.length > 0) refuseInput([`a list read takes only source and list; it does not take ${extra.join(", ")}`])
        const source = rest["source"]
        if (typeof source === "string" && source !== SOURCE) throw sourceUnknown(source)
        const known = runtime.provider.owner(call.account)
        return meetingsList(runtime.provider.reader(call, call.account), call.account, runtime.clock(), known === undefined ? undefined : ownerEmail(known))
      }

      const parsed = parseEventsListInput(rest)
      if (!parsed.ok) refuseInput(parsed.problems)
      if (parsed.value.source !== undefined && parsed.value.source !== SOURCE) throw sourceUnknown(parsed.value.source)
      const now = runtime.clock()
      const owner = await runtime.provider.ensureOwner(call, call.account)
      return listEvents(runtime.provider.reader(call, call.account), rest, {
        alias: call.account,
        owner,
        now,
        plan: runtime.provider.planOf(call.account, now, PLAN_TTL_MS),
      })
    },
  }
}
