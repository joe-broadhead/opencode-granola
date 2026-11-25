/**
 * `probe`: whose an account is. It reads `get_account_info` once and never any meeting content.
 *
 * The owner is the Granola account's email under the `mailto:` scheme; the plan the read names is kept for
 * `events_list`'s free-plan window, per alias.
 */
import { parseProbeInput, PROBE_SCHEMA, probeResult } from "@we-the-rebel-alliance/plugin-contract/events"
import type { MethodHandler } from "@we-the-rebel-alliance/plugin-contract/register"
import { refuseInput } from "./shared.ts"
import { SOURCE } from "../provider/meetings.ts"
import { sourceUnknown } from "../provider/errors.ts"
import type { HandlerRuntime } from "./index.ts"

/** `probe`: the owner and the provider sign-in's scopes for one account. */
export function probeHandler(runtime: HandlerRuntime): MethodHandler {
  return {
    description: "Read the signed-in Granola owner and note-access scopes for one account. It reads no meetings.",
    input: {
      type: "object",
      properties: { source: { type: "string", description: "The source to probe; only granola." } },
      additionalProperties: false,
    },
    output: PROBE_SCHEMA,
    async run(input, call) {
      const parsed = parseProbeInput(input)
      if (!parsed.ok) refuseInput(parsed.problems)
      if (parsed.value.source !== undefined && parsed.value.source !== SOURCE) throw sourceUnknown(parsed.value.source)
      const read = await runtime.provider.probe(call, call.account)
      return probeResult(
        { source: SOURCE, account: call.account, owner: read.owner },
        {
          ...(read.scopes === undefined ? {} : { scopes: [...read.scopes] }),
        },
      )
    },
  }
}
