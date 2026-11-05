import { registerToolsRpc } from "../src/host/tools-rpc.js"
import type { Rule } from "../src/permissions.js"
import type { SetupContext, ToolsRpc } from "../src/setup.js"

type Listed<T extends (...args: never[]) => Promise<{ data: readonly unknown[] }>> = Awaited<ReturnType<T>>["data"][number]
export type FakeServer = Listed<SetupContext["mcp"]["list"]>
type AgentInfo = Listed<SetupContext["agent"]["list"]>
type SkillInfo = Listed<SetupContext["skill"]["list"]>
type ToolInfo = Awaited<ReturnType<SetupContext["tool"]["list"]>>[number]
type Registration = Awaited<ReturnType<SetupContext["mcp"]["transform"]>>
type CommandInput = Parameters<Parameters<Parameters<SetupContext["command"]["transform"]>[0]>[0]["add"]>[0]

/** Records every transform and hook so tests can replay them the way the host rebuilds state. */
export interface FakeHost {
  ctx: SetupContext
  /** The tools RPC, registered on this fake with the few more context parts it uses. */
  toolsRpc: ToolsRpc
  /** The permission evaluate hook the tools RPC registered, if any. */
  evaluate?: (evaluation: unknown) => void
  /** Sessions ctx.session.get finds, with their agent and own rules. */
  sessions: Map<string, { agent?: string; permissions?: Rule[] }>
  agents: Map<string, { id: string; permissions: Rule[] }>
  servers: Map<string, Record<string, unknown>>
  tools: Map<string, { id: string; name: string; description?: string; options?: Record<string, unknown>; input?: unknown; output?: unknown; execute?: (input: unknown, context: unknown) => Promise<unknown> }>
  namespaces: Map<string, string>
  commands: Map<string, { name: string; description?: string; execute: (input: { sessionID: string; delivery: "steer" | "queue"; prompt: unknown }) => Promise<void> }>
  skills: Map<string, Record<string, unknown>>
  synthetic: Record<string, unknown>[]
  hooks: Map<string, (event: unknown) => Promise<void> | void>
  /** RPC handlers by contract id, as registered through ctx.rpc.register. */
  rpc: Map<string, Record<string, (input: unknown, context: unknown) => Promise<unknown>>>
  /** Mutable inputs for ctx.mcp.list(), ctx.agent.list() and ctx.skill.list(). */
  listed: { servers: FakeServer[]; agents: { id: string; permissions: Rule[] }[]; skills: { id: string; path: string }[] }
  /** Replays every transform from the given base state, like a host rebuild. */
  rebuild(): void
}

interface Options {
  version?: string
  options?: Record<string, unknown>
  baseAgents?: () => { id: string; permissions: Rule[] }[]
  baseServers?: () => [string, Record<string, unknown>][]
  baseTools?: () => { id: string; name: string; options?: Record<string, unknown> }[]
}

const registration = (): Registration => ({ dispose: async () => {} })
const location = { directory: "/project" }

/** OpenCode's agent listing for an agent of the given id and permissions. */
const agentInfo = (agent: { id: string; permissions: Rule[] }): AgentInfo =>
  ({ ...agent, name: agent.id, request: { settings: {}, headers: {}, body: {} }, mode: "primary", hidden: false })

/** An event stream with nothing in it, which ends when its signal aborts. */
function quiet(signal: AbortSignal | undefined): AsyncIterable<never> {
  return {
    [Symbol.asyncIterator]: () => ({
      next: () => new Promise<IteratorResult<never>>((resolve) => {
        if (signal?.aborted) return resolve({ done: true, value: undefined })
        signal?.addEventListener("abort", () => resolve({ done: true, value: undefined }), { once: true })
      }),
      return: async () => ({ done: true, value: undefined }),
    }),
  }
}

export function fakeHost(config: Options = {}): FakeHost {
  const transforms: { domain: keyof typeof editors; run: (editor: never) => void }[] = []
  const editors = {
    agent: () => ({
      list: () => [...host.agents.values()],
      get: (id: string) => host.agents.get(id),
      update: (id: string, update: (agent: { id: string; permissions: Rule[] }) => void) => {
        const agent = host.agents.get(id) ?? { id, permissions: [{ action: "*", resource: "*", effect: "allow" as const }] }
        host.agents.set(id, agent)
        update(agent)
      },
      default: () => {},
      remove: (id: string) => host.agents.delete(id),
    }),
    mcp: () => ({
      list: () => [...host.servers.entries()],
      get: (name: string) => host.servers.get(name),
      set: (name: string, value: Record<string, unknown>) => host.servers.set(name, value),
      update: () => {},
      remove: (name: string) => host.servers.delete(name),
    }),
    tool: () => ({
      list: () => [...host.tools.values()],
      get: (id: string) => host.tools.get(id),
      namespace: (namespace: { name: string; description: string }) => host.namespaces.set(namespace.name, namespace.description),
      add: (tool: { name: string; options?: { namespace?: string } }) => {
        const id = tool.options?.namespace ? `${tool.options.namespace}_${tool.name}` : tool.name
        host.tools.set(id, { ...tool, id })
      },
      update: () => {},
      remove: (id: string) => host.tools.delete(id),
    }),
    command: () => ({ add: (command: CommandInput) => host.commands.set(command.name, command as never) }),
    skill: () => ({ add: (skill: { id: string }) => host.skills.set(skill.id, skill), list: () => [], get: () => undefined, update: () => {}, remove: () => {} }),
  }
  // The fake editors implement what the plugin calls; the host's editor types are wider.
  const transform = (domain: keyof typeof editors) => async (run: (editor: never) => void): Promise<Registration> => {
    transforms.push({ domain, run })
    host.rebuild()
    return registration()
  }

  const ctx = {
    app: { version: config.version ?? "2.2.3" },
    options: config.options ?? {},
    agent: { transform: transform("agent"), list: async () => ({ location, data: host.listed.agents.map(agentInfo) }) },
    mcp: { transform: transform("mcp"), list: async () => ({ location, data: host.listed.servers }) },
    tool: {
      transform: transform("tool"),
      list: async () => [...host.tools.values()] as unknown as ToolInfo[],
      hook: async (name: string, callback: (event: never) => Promise<void> | void) => {
        host.hooks.set(name, callback as (event: unknown) => Promise<void> | void)
        return registration()
      },
    },
    command: { transform: transform("command") },
    skill: {
      transform: transform("skill"),
      list: async () => ({ location, data: host.listed.skills.map((skill) => ({ ...skill, name: skill.id, content: "" })) as unknown as SkillInfo[] }),
    },
    rpc: {
      register: async (definition: { id: string }, handlers: object) => {
        host.rpc.set(definition.id, handlers as Record<string, (input: unknown, context: unknown) => Promise<unknown>>)
        return { dispose: async () => void host.rpc.delete(definition.id), events: { emit: async () => {} } }
      },
    },
    session: {
      synthetic: async (input: { sessionID: string; delivery?: "steer" | "queue" | null; text: string; description?: string | null }) => {
        host.synthetic.push(input)
        const payload = { text: input.text, ...(input.description ? { description: input.description } : {}) }
        return { id: "msg_synthetic", sessionID: input.sessionID, time: { created: 0 }, type: "synthetic" as const, payload, delivery: input.delivery ?? "queue" }
      },
    },
    permission: { assert: async () => {} },
    integration: {
      transform: async () => registration(),
      get: async () => ({ location, data: { id: "", name: "", methods: [], connections: [] } }),
      connection: { active: async () => undefined, resolve: async () => undefined, status: async () => {} },
    },
    event: { subscribe: (options?: { signal?: AbortSignal }) => quiet(options?.signal) },
  } satisfies SetupContext

  // The tools RPC also reads sessions and agents and hooks permission evaluation; setup's context leaves those out.
  const toolsRpc: ToolsRpc = (options) => registerToolsRpc({
    ...ctx,
    location,
    session: {
      ...ctx.session,
      get: async ({ sessionID }: { sessionID: string }) => {
        const session = host.sessions.get(sessionID)
        if (!session) throw Object.assign(new Error(`Session not found: ${sessionID}`), { _tag: "Session.NotFoundError" })
        return { id: sessionID, location, ...session }
      },
    },
    agent: {
      ...ctx.agent,
      get: async ({ agentID }: { agentID: string }) => {
        const agent = host.listed.agents.find((entry) => entry.id === agentID)
        if (!agent) throw Object.assign(new Error(`Agent not found: ${agentID}`), { _tag: "Agent.NotFoundError" })
        return { location, data: agentInfo(agent) }
      },
    },
    permission: {
      ...ctx.permission,
      hook: async (_name: "evaluate", callback: (evaluation: unknown) => void) => {
        host.evaluate = callback
        return { dispose: async () => void (host.evaluate = undefined) }
      },
    },
  } as never, options)

  const host: FakeHost = {
    ctx,
    toolsRpc,
    sessions: new Map(),
    agents: new Map(),
    servers: new Map(),
    tools: new Map(),
    namespaces: new Map(),
    commands: new Map(),
    skills: new Map(),
    synthetic: [],
    hooks: new Map(),
    rpc: new Map(),
    listed: { servers: [], agents: [], skills: [] },
    rebuild() {
      host.agents = new Map((config.baseAgents?.() ?? []).map((agent) => [agent.id, agent]))
      host.servers = new Map(config.baseServers?.() ?? [])
      host.tools = new Map((config.baseTools?.() ?? []).map((tool) => [tool.id, tool]))
      host.namespaces = new Map()
      host.commands = new Map()
      host.skills = new Map()
      for (const entry of transforms) entry.run(editors[entry.domain]() as never)
    },
  }
  return host
}

/** The host's base policy for a built-in agent, plus the extra rules that make it what it is. */
export function agent(id: string, ...extra: Rule[]): { id: string; permissions: Rule[] } {
  return {
    id,
    permissions: [
      { action: "*", resource: "*", effect: "allow" },
      { action: "read", resource: "*.env", effect: "ask" },
      ...extra,
    ],
  }
}
