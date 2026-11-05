import { afterEach, describe, expect, it, vi } from "vitest"
import { DISPLAY_NAME, SIGN_IN_MESSAGE, registerIntegration, type IntegrationContext } from "../src/integration.js"

type State = "connected" | "needs_auth" | "pending"
type Status = { status: "needs_auth"; message: string } | undefined

/** The parts of OpenCode that the integration module uses: the MCP list, integration transforms and events. */
function fakeOpenCode() {
  const server = { name: "granola", integrationID: "mcp_1", status: { status: "needs_auth" as State } }
  const integration = { id: "mcp_1", name: "granola" }
  const transforms: { run: (editor: never) => void; live: boolean }[] = []
  const reported: Status[] = []
  let connection: { type: "credential"; id: string; label: string; method: "oauth"; status?: Status } | undefined =
    { type: "credential", id: "cred_1", label: "granola", method: "oauth" }
  const listeners = new Set<() => void>()

  // OpenCode's own transform names the integration after the server; the plugin's replay after it.
  const replay = () => {
    integration.name = "granola"
    const editor = { get: (id: string) => (id === integration.id ? integration : undefined), update: (_: string, change: (value: typeof integration) => void) => change(integration) }
    for (const transform of transforms) if (transform.live) transform.run(editor as never)
  }
  const emit = () => listeners.forEach((listener) => listener())

  const ctx = {
    mcp: { list: async () => ({ location: {}, data: [server] }) },
    integration: {
      transform: async (run: (editor: never) => void) => {
        const entry = { run, live: true }
        transforms.push(entry)
        replay()
        return { dispose: async () => void (entry.live = false) }
      },
      get: async () => ({ location: {}, data: { ...integration } }),
      connection: {
        active: async () => connection,
        status: async (input: { status: Status }) => {
          reported.push(input.status)
          if (connection) connection = { ...connection, ...(input.status ? { status: input.status } : { status: undefined }) }
        },
      },
    },
    event: {
      subscribe: ({ signal }: { signal: AbortSignal }) => ({
        [Symbol.asyncIterator]: () => ({
          next: () => new Promise<IteratorResult<unknown>>((resolve) => {
            const listener = () => {
              listeners.delete(listener)
              resolve({ done: false, value: {} })
            }
            listeners.add(listener)
            signal.addEventListener("abort", () => resolve({ done: true, value: undefined }), { once: true })
          }),
          return: async () => ({ done: true, value: undefined }),
        }),
      }),
    },
  }
  return {
    ctx: ctx as unknown as IntegrationContext,
    server,
    integration,
    reported,
    live: () => transforms.filter((transform) => transform.live).length,
    signOut: () => void (connection = undefined),
    /** OpenCode registers the integration again, for example after a config change, and publishes the update. */
    reregister: () => {
      replay()
      integration.name = "granola"
      emit()
    },
    setState: (state: State) => {
      server.status.status = state
      emit()
    },
  }
}

async function until(done: () => boolean): Promise<void> {
  for (const deadline = Date.now() + 2_000; !done(); await new Promise((resolve) => setTimeout(resolve, 5))) {
    if (Date.now() > deadline) throw new Error("timed out")
  }
}

const disposers: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose()
})

async function start(fake: ReturnType<typeof fakeOpenCode>, conflict: () => string | undefined = () => undefined) {
  const registration = await registerIntegration(fake.ctx, conflict)
  disposers.push(() => registration.dispose())
  return registration
}

describe("Granola's integration in /connect", () => {
  it("is named Granola, and named again after OpenCode registers it anew", async () => {
    const fake = fakeOpenCode()
    await start(fake)
    await until(() => fake.integration.name === DISPLAY_NAME)
    fake.reregister()
    await until(() => fake.integration.name === DISPLAY_NAME)
    expect(fake.live()).toBe(1)
  })

  it("marks the stored sign-in as needing a new sign-in, once, and clears the mark when Granola connects", async () => {
    const fake = fakeOpenCode()
    await start(fake)
    await until(() => fake.reported.length === 1)
    expect(fake.reported).toEqual([{ status: "needs_auth", message: SIGN_IN_MESSAGE }])
    fake.setState("needs_auth")
    fake.setState("connected")
    await until(() => fake.reported.length === 2)
    expect(fake.reported[1]).toBeUndefined()
  })

  it("reports nothing without a stored sign-in or while connecting", async () => {
    const fake = fakeOpenCode()
    fake.signOut()
    await start(fake)
    await until(() => fake.integration.name === DISPLAY_NAME)
    fake.setState("pending")
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fake.reported).toEqual([])
  })

  it("leaves a granola server that the user configured alone", async () => {
    const fake = fakeOpenCode()
    await start(fake, () => "conflict")
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fake.integration.name).toBe("granola")
    expect(fake.reported).toEqual([])
  })

  it("runs exactly one more check for the events that arrive during a check", async () => {
    // Fake timers hold the startup poll's next check back, so every check here comes from an event.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    try {
      const fake = fakeOpenCode()
      const list = fake.ctx.mcp.list.bind(fake.ctx.mcp)
      let release = () => {}
      let gate: Promise<void> | undefined = new Promise((resolve) => (release = resolve))
      let checks = 0
      fake.ctx.mcp.list = (async (...args: Parameters<typeof list>) => {
        checks++
        if (gate) await gate
        return list(...args)
      }) as typeof list
      const settle = () => vi.advanceTimersByTimeAsync(0)
      await start(fake)
      await settle()
      expect(checks).toBe(1)
      for (const state of ["connected", "needs_auth", "connected"] as const) {
        fake.setState(state)
        await settle()
      }
      expect(checks).toBe(1)
      gate = undefined
      release()
      await settle()
      expect(checks).toBe(2)
      await settle()
      expect(checks).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("removes its rename on dispose", async () => {
    const fake = fakeOpenCode()
    const registration = await start(fake)
    await until(() => fake.live() === 1)
    await registration.dispose()
    expect(fake.live()).toBe(0)
  })
})
