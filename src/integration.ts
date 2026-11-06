import type { Plugin } from "@opencode/plugin"
import { SERVER } from "./known-tools.js"

/** The name /connect shows for Granola's sign-in. OpenCode names an MCP integration after its server. */
export const DISPLAY_NAME = "Granola"

/** Shown by /connect as "Sign in required" when Granola rejects the stored sign-in. */
export const SIGN_IN_MESSAGE = "Granola needs you to sign in again."

const STARTUP_POLL_MS = 250
const STARTUP_WINDOW_MS = 10_000
const RESUBSCRIBE_MS = 5_000

export interface IntegrationContext {
  readonly mcp: Pick<Plugin.Context["mcp"], "list">
  readonly integration: Pick<Plugin.Context["integration"], "transform" | "get" | "connection">
  readonly event: Pick<Plugin.Context["event"], "subscribe">
}

type Registration = Awaited<ReturnType<Plugin.Context["integration"]["transform"]>>

/**
 * Keeps the Granola server's integration named "Granola" and mirrors its sign-in state into /connect.
 *
 * OpenCode registers the integration after plugin setup and again whenever the server's config changes, and its
 * transform names it after the server. Transforms replay in registration order, so the rename is registered once
 * the integration exists and again whenever the name reverts. OpenCode publishes `integration.updated` for both;
 * a subscription has no start acknowledgement, so the first seconds are also polled.
 *
 * When the server needs a new sign-in while a stored sign-in exists, the connection is marked `needs_auth`, and the
 * mark is cleared once Granola connects again. A server named granola that the user configured is left alone.
 */
export async function registerIntegration(ctx: IntegrationContext, conflict: () => string | undefined): Promise<{ dispose(): Promise<void> }> {
  const stopped = new AbortController()
  let registration: Registration | undefined
  let attached: string | undefined

  const attach = async (id: string) => {
    const next = await ctx.integration.transform((editor) => {
      if (editor.get(id)) editor.update(id, (integration) => void (integration.name = DISPLAY_NAME))
    })
    const previous = registration
    registration = next
    attached = id
    await previous?.dispose()
  }

  const detach = async () => {
    const previous = registration
    registration = undefined
    attached = undefined
    await previous?.dispose()
  }

  const check = async () => {
    if (conflict()) return detach()
    const server = (await ctx.mcp.list()).data.find((entry) => entry.name === SERVER)
    const id = server?.integrationID
    if (!server || !id || stopped.signal.aborted) return
    if (id !== attached || (await ctx.integration.get({ integrationID: id })).data.name !== DISPLAY_NAME) await attach(id)

    const connection = await ctx.integration.connection.active(id)
    if (connection?.type !== "credential") return
    // `active` returns the credential alone; the status the plugin sets is projected by `get`. Read it there, so the
    // mark it wrote is the one it clears, and another plugin's or the host's message is left alone.
    const shown = (await ctx.integration.get({ integrationID: id })).data.connections?.find((item) => item.type === "credential" && item.id === connection.id)
    const status = shown?.type === "credential" ? shown.status : undefined
    const state = server.status.status
    if (state === "needs_auth" && status?.status !== "needs_auth") {
      await ctx.integration.connection.status({ integrationID: id, connection, status: { status: "needs_auth", message: SIGN_IN_MESSAGE } })
    } else if (state === "connected" && status?.message === SIGN_IN_MESSAGE) {
      await ctx.integration.connection.status({ integrationID: id, connection, status: undefined })
    }
  }

  // One check at a time; triggers that arrive meanwhile cause one more check after it.
  let checking: Promise<void> | undefined
  let again = false
  const schedule = (): Promise<void> => {
    if (checking) {
      again = true
      return checking
    }
    checking = (async () => {
      do {
        again = false
        if (!stopped.signal.aborted) await check().catch(() => undefined)
      } while (again)
    })().finally(() => {
      checking = undefined
    })
    return checking
  }

  const listen = (async () => {
    while (!stopped.signal.aborted) {
      await forEachEvent(ctx, stopped.signal, () => void schedule()).catch(() => undefined)
      // The stream ended without dispose: check, then subscribe again.
      if (!stopped.signal.aborted) void schedule()
      await delay(RESUBSCRIBE_MS, stopped.signal)
    }
  })()
  const startup = (async () => {
    const until = Date.now() + STARTUP_WINDOW_MS
    while (!stopped.signal.aborted && Date.now() < until) {
      await schedule()
      await delay(STARTUP_POLL_MS, stopped.signal)
    }
  })()

  return {
    async dispose() {
      stopped.abort()
      await Promise.all([listen, startup, checking])
      await detach()
    },
  }
}

async function forEachEvent(ctx: IntegrationContext, signal: AbortSignal, handle: () => void): Promise<void> {
  const iterator = ctx.event.subscribe({ types: ["integration.updated", "mcp.status.changed"], signal })[Symbol.asyncIterator]()
  let stop = () => {}
  const aborted = new Promise<undefined>((resolve) => {
    stop = () => resolve(undefined)
  })
  signal.addEventListener("abort", stop, { once: true })
  try {
    while (!signal.aborted) {
      // Waiting on the abort too: a pending next() is not guaranteed to settle on return().
      const result = await Promise.race([iterator.next(), aborted])
      if (!result || result.done) return
      handle()
    }
  } finally {
    signal.removeEventListener("abort", stop)
    void iterator.return?.()?.catch(() => undefined)
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener("abort", done, { once: true })
  })
}
