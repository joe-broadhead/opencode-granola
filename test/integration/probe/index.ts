// Test-only plugin, configured after granola.meetings so its transforms run later. It routes Granola's official
// URL to the synthetic server, records what the Granola plugin registered, and runs tools and permission checks
// in a real session the way a model turn would, without a model. Public plugin API only.
import { Plugin } from "@opencode/plugin"
import { Rpc } from "@opencode/plugin/rpc"

const OFFICIAL_URL = "https://mcp.granola.ai/mcp"
const json = { type: "object" } as const

export const Probe = Rpc.define({
  id: "granola.test.probe",
  methods: {
    state: { input: json, output: json },
    reload: { input: json, output: json },
    call: { input: json, output: json },
    check: { input: json, output: json },
  },
  events: {},
})

export interface ProbeOptions {
  /** The synthetic server endpoint that stands in for the official URL. */
  readonly route: string
  readonly budget?: boolean
}

export type Decision = "once" | "always" | "reject"

export interface ProbeState {
  /** The granola server entry as the probe found it, before routing; null when there was none. */
  readonly registered: unknown
  readonly agents: readonly { readonly id: string; readonly permissions: readonly { action: string; resource: string; effect: "allow" | "deny" | "ask" }[] }[]
  /** Tools whose id starts with granola_. */
  readonly tools: readonly { readonly id: string; readonly namespace: string | null; readonly pinned: boolean }[]
  readonly servers: readonly { readonly name: string; readonly title?: string; readonly status: { readonly status: string; readonly error?: string } }[]
}

export interface CallInput {
  readonly agent: string
  readonly tool: string
  readonly input?: unknown
  /** Replies to the permission requests the call raises, in order; any further request is rejected. */
  readonly replies?: readonly Decision[]
}

export interface Asked {
  readonly action: string
  readonly resources: readonly string[]
  readonly save?: readonly string[]
  readonly metadata?: Record<string, unknown>
}

export interface Failure {
  readonly message: string
  /** The plugin's error code, from Tool.Error metadata. */
  readonly code?: string
  /** The tag of the error or of its cause, such as Permission.DeclinedError. */
  readonly tag?: string
}

export type CallResult =
  | { readonly asked: readonly Asked[]; readonly output: unknown; readonly content: unknown }
  | { readonly asked: readonly Asked[]; readonly error: Failure }
  | { readonly asked: readonly Asked[]; readonly missing: true }

export type Outcome = { readonly outcome: "allow" | "deny" } | { readonly outcome: "ask"; readonly afterReply: "allowed" | "rejected" }

const sleep = (ms: number) => new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms))
/** RPC output is checked against JSON Schema, which rejects undefined fields. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

function failure(error: unknown): Failure {
  const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null
  const metadata = record(error) && record(error.metadata) ? error.metadata : undefined
  const cause = record(error) && record(error.error) ? error.error : undefined
  const tag = [error, cause].map((item) => (record(item) && typeof item._tag === "string" ? item._tag : undefined)).find((item) => item && item !== "Tool.Error")
  return plain({
    message: error instanceof Error ? error.message : String(error),
    code: typeof metadata?.code === "string" ? metadata.code : undefined,
    tag,
  })
}

export default Plugin.define({
  id: "granola.test.probe",
  async setup(ctx) {
    const options = ctx.options as ProbeOptions
    let registered: unknown = null
    let calls = 0

    if (options.budget) await ctx.tool.transform((editor) => {
      const schema = () => ({ type: "object", properties: { note: { type: "string", description: "x".repeat(9000) } }, required: ["note"] })
      const input = { "~standard": { version: 1, vendor: "test", validate: (value: unknown) => ({ value }), jsonSchema: { input: schema, output: schema } } }
      editor.namespace({ name: "filler", description: "Spends the inline budget." })
      editor.add({ name: "pad", description: "pad", input, options: { namespace: "filler", permission: "filler_pad", pinned: true }, execute: async () => ({ content: "ok" }) } as never)
    })

    await ctx.mcp.transform((editor) => {
      const config = editor.get("granola")
      registered = config === undefined ? null : plain(config)
      // The long startup timeout keeps the pending route pending for the whole test.
      if (config?.type === "remote" && config.url === OFFICIAL_URL) {
        editor.set("granola", { ...config, url: options.route, timeout: { ...config.timeout, startup: 600_000 } })
      }
    })

    const state = async (): Promise<ProbeState> => plain({
      registered,
      agents: (await ctx.agent.list()).data.map((agent) => ({ id: agent.id, permissions: agent.permissions })),
      tools: (await ctx.tool.list())
        .filter((tool) => tool.id.startsWith("granola_"))
        .map((tool) => ({ id: tool.id, namespace: tool.options?.namespace ?? null, pinned: tool.options !== undefined && "pinned" in tool.options && tool.options.pinned === true })),
      servers: (await ctx.mcp.list()).data,
    })

    /** Waits for `settled`, answering each permission request the session raises meanwhile. */
    async function answer<T>(sessionID: string, settled: Promise<T>, replies: readonly Decision[]): Promise<{ asked: Asked[]; value?: T }> {
      const asked: Asked[] = []
      const answered = new Set<string>()
      for (const deadline = Date.now() + 60_000; Date.now() < deadline;) {
        const done = await Promise.race([settled.then((value) => ({ value })), sleep(25)])
        if (done !== undefined) return { asked, value: done.value }
        const pending = (await ctx.permission.list({ sessionID })).find((request) => !answered.has(request.id))
        if (pending === undefined) continue
        answered.add(pending.id)
        asked.push(plain({ action: pending.action, resources: pending.resources, save: pending.save, metadata: pending.metadata }))
        await ctx.permission.reply({ sessionID, requestID: pending.id, decision: replies[asked.length - 1] ?? "reject" })
      }
      return { asked }
    }

    await ctx.rpc.register(Probe, {
      state: async () => state(),
      reload: async () => {
        await ctx.agent.reload()
        return state()
      },
      // Runs a registered tool's executor, as OpenCode does for a model's tool call.
      call: async (raw) => {
        const input = raw as unknown as CallInput
        const tool = (await ctx.tool.list()).find((entry) => entry.id === input.tool)
        if (tool === undefined) return { asked: [], missing: true }
        const session = await ctx.session.create({ title: `probe ${input.agent} ${input.tool}` })
        const context = {
          sessionID: session.id as never,
          agent: input.agent as never,
          messageID: `msg_probe${Date.now()}${++calls}` as never,
          id: `call_probe_${calls}` as never,
          signal: new AbortController().signal,
          progress: async () => {},
        }
        const settled = tool.execute((input.input ?? {}) as never, context).then(
          (result) => plain({ output: result.output ?? null, content: result.content ?? null }),
          (error: unknown) => ({ error: failure(error) }),
        )
        const { asked, value } = await answer(session.id, settled, input.replies ?? [])
        if (value === undefined) throw new Error(`${input.tool} did not finish`)
        return { asked, ...value }
      },
      // Evaluates one permission request the way an MCP tool asserts it, for actions that are not tools here.
      check: async (raw) => {
        const input = raw as { agent: string; action: string; resource?: string }
        const session = await ctx.session.create({ title: `probe ${input.agent} ${input.action}` })
        const resources = [input.resource ?? "*"]
        const settled = ctx.permission
          .assert({ sessionID: session.id, agent: input.agent as never, action: input.action, resources, save: resources })
          .then(() => "allowed" as const, () => "rejected" as const)
        const { asked, value } = await answer(session.id, settled, [])
        if (value === undefined) throw new Error(`${input.action} did not settle`)
        return (asked.length ? { outcome: "ask", afterReply: value } : { outcome: value === "allowed" ? "allow" : "deny" }) satisfies Outcome
      },
    })
  },
})
