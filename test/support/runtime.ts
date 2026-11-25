/** A handler runtime over the fake MCP server, for unit tests and the recorded fixture. */
import { accountsOf, type AccountProfile } from "@we-the-rebel-alliance/plugin-contract/accounts"
import type { MethodCall } from "@we-the-rebel-alliance/plugin-contract/register"
import { handlersFor, type HandlerRuntime } from "../../src/handlers/index.ts"
import { manifest, packageName, version } from "../../src/manifest.ts"
import { createProvider } from "../../src/provider/client.ts"
import { ACCOUNTS, NOW, createFakeMCP, type FakeMCP } from "./granola.ts"

export const ALIASES = ["work", "personal"] as const

/** The profiles the tests configure: one empty profile per alias. */
export function profiles(): readonly AccountProfile[] {
  const plan = accountsOf(manifest, { accounts: { work: {}, personal: {} } })
  if (!plan.ok) throw new Error(plan.problems.join("; "))
  return plan.value.accounts
}

export interface TestRuntime {
  readonly runtime: HandlerRuntime
  readonly fake: FakeMCP
}

/** A runtime with the two synthetic aliases, a connected fake server and a fixed clock. */
export function testRuntime(options: { readonly exportDirectory?: string; readonly now?: number; readonly fake?: FakeMCP } = {}): TestRuntime {
  const fake = options.fake ?? createFakeMCP(ACCOUNTS, { now: options.now ?? NOW })
  return {
    fake,
    runtime: {
      manifest,
      packageName,
      version,
      hostVersion: "2.4.1",
      accounts: profiles(),
      accountProblems: [],
      exportDirectory: options.exportDirectory ?? "/tmp/opencode/granola-export",
      provider: createProvider(fake.context, manifest.plugin.name, () => options.now ?? NOW),
      clock: () => options.now ?? NOW,
    },
  }
}

/** A fake method call: the account the register would have resolved, and a bus that records nothing. */
export function methodCall(account: string, overrides: Partial<MethodCall> = {}): MethodCall {
  return {
    sessionID: "ses_test",
    agent: "build",
    messageID: "msg_test",
    id: "call_test",
    signal: new AbortController().signal,
    progress: async () => {},
    account,
    bus: { emit: async () => ({ ok: true }) } as unknown as MethodCall["bus"],
    unguardedAgents: async () => ({ ok: true, agents: [] }),
    door: "tool",
    ...overrides,
  }
}

/** Run one handler directly, the way the register runs it after resolving the account. */
export async function runHandler(runtime: HandlerRuntime, method: string, input: Record<string, unknown>, account: string, overrides: Partial<MethodCall> = {}): Promise<unknown> {
  const handler = handlersFor(runtime)[method]
  if (handler === undefined) throw new Error(`no handler for ${method}`)
  const rest = { ...input }
  delete rest["account"]
  return handler.run(rest, methodCall(account, overrides))
}

/** The message of a refusal, for a recorded fixture. */
export async function refusal(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  throw new Error("expected a refusal")
}
