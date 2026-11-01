// Renders the prebuilt dist/tui.js with OpenTUI's test renderer and prints one RESULT line of JSON.
// OpenTUI 0.8 runs on Bun; render.test.ts starts this file with `bun --preload @opentui/solid/preload`, which also
// loads Solid's client build. dist/tui.js is plain JavaScript, so the preload's JSX transform never touches it.
import { testRender } from "@opentui/solid"
import { readFileSync } from "node:fs"
import { getOwner } from "solid-js"
import type { Status } from "../../src/rpc/contract.js"

// The package ships no declarations, so the built part's type comes from the source.
const { default: plugin } = (await import(new URL("../../dist/tui.js", import.meta.url).href)) as typeof import("../../src/tui/index.js")

type Command = { id: string; title: string; group: string; palette: boolean; slash: { name: string }; run: () => void }
type Layer = { mode?: string; commands: { id?: string; title: string; bind?: string; run: () => void }[] }

export interface Scenario {
  /** The RPC answer, or the failure the client throws. */
  readonly rpc: { status: Status } | { error: { type: string; message: string } }
}

const VERSION = (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version
const SIGN_IN = "Run /connect and choose Granola, or run opencode mcp auth granola in a terminal."
const tone = (base: string) => ({ base, muted: base })
const colors = { text: { base: "#eeeeee", muted: "#888888", feedback: { success: tone("#00ff00"), warning: tone("#ffff00"), error: tone("#ff0000"), info: tone("#00ffff") } } }
const theme = { ...colors, surface: () => colors }

function status(overrides: Partial<Status>): Status {
  return {
    state: "connected",
    title: "Granola",
    tools: { visible: 17, hidden: 1, unknown: 0, unknownNames: [] },
    unguardedAgents: [],
    exportDirectory: "/home/someone/Granola",
    pluginVersion: VERSION,
    hostVersion: "2.2.3",
    next: "Nothing to do.",
    ...overrides,
  }
}

const signedOut: Status = status({
  state: "needs_auth",
  title: undefined,
  tools: { visible: 0, hidden: 0, unknown: 0, unknownNames: [] },
  problem: { code: "AUTH_REQUIRED", message: "Granola needs you to sign in.", next: SIGN_IN },
  next: SIGN_IN,
})

const SCENARIOS: Record<string, Scenario> = {
  "needs sign-in": { rpc: { status: signedOut } },
  connecting: {
    rpc: { status: status({ state: "pending", title: undefined, problem: { code: "CONNECTING", message: "Granola is still connecting.", next: "Retry in a few seconds." }, next: "Retry in a few seconds." }) },
  },
  "connected without a workspace": { rpc: { status: status({}) } },
  "connected with a workspace": {
    rpc: { status: status({ workspace: "Acme Research" }) },
  },
  "RPC unavailable": {
    rpc: { error: { type: "rpc.unavailable", message: "No handler for granola.meetings" } },
  },
  "agents without the defaults": {
    rpc: {
      status: status({
        unguardedAgents: ["reviewer"],
        permissionsBlock: [{ action: "granola_*", resource: "*", effect: "ask" }, { action: "granola_get_meetings", resource: "*", effect: "allow" }],
        next: "Put the Granola block first in that agent's own permissions (agents.reviewer.permissions), followed by your top-level rules for granola_ actions.",
      }),
    },
  },
}

const settle = async () => {
  for (let pass = 0; pass < 3; pass++) await new Promise((resolve) => setTimeout(resolve, 0))
}

async function run(scenario: Scenario) {
  const listeners = new Map<string, Set<(event: unknown) => void>>()
  const dialogs: { render: () => unknown; onClose?: () => void }[] = []
  const layers: Layer[] = []
  const commands: Command[] = []
  const calls: { id: string; input: unknown; options: unknown }[] = []
  let cleared = 0
  const context = {
    options: {},
    location: { directory: "/project" },
    app: { version: "2.2.3", channel: "latest" },
    theme,
    client: {
      rpc: (definition: { id: string }) => ({
        status: async (input: unknown, options: unknown) => {
          calls.push({ id: definition.id, input, options })
          if ("error" in scenario.rpc) throw scenario.rpc.error
          return scenario.rpc.status
        },
      }),
    },
    data: {
      on: (type: string, handler: (event: unknown) => void) => {
        const set = listeners.get(type) ?? new Set()
        listeners.set(type, set.add(handler))
        return () => void set.delete(handler)
      },
    },
    ui: {
      slot: () => {
        throw new Error("the TUI part must not claim slots")
      },
      dialog: {
        show: (render: () => unknown, onClose?: () => void) => void dialogs.push({ render, onClose }),
        set: () => {},
        clear: () => void cleared++,
      },
    },
    keymap: {
      // The host's keymap context is reachable only from setup itself or from host-rendered components, never
      // from a root the plugin creates. The dialog's own layer is created while the host renders it.
      layer: (factory: () => Layer) => {
        const layer = factory()
        if (layer.mode === "global" && getOwner()) throw new Error("Keymap.Provider is missing")
        layers.push(layer)
        if (layer.mode === "global") commands.push(...(layer.commands as Command[]))
      },
    },
  }
  const emit = (type: string, event: unknown) => listeners.get(type)?.forEach((handler) => handler(event))
  const listening = () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0)

  const cleanup = await plugin.setup(context as never)
  await settle()
  const result: Record<string, unknown> = {
    modes: layers.map((layer) => layer.mode),
    commands: commands.map(({ run: _, ...command }) => command),
  }

  // Nothing is fetched until the dialog opens, and events while it is closed do nothing.
  emit("mcp.status.changed", { data: { server: "granola" } })
  await settle()
  const beforeOpen = calls.length
  result.listeners = { beforeOpen: listening() }

  commands[0]!.run()
  const dialog = dialogs[0]!
  const screen = await testRender(dialog.render as never, { width: 72, height: 40 })
  await settle()
  await screen.renderOnce()
  result.dialog = screen.captureCharFrame().split("\n").map((line) => line.trimEnd()).join("\n").trimEnd()
  const dialogLayer = layers.find((layer) => layer.mode === "modal")
  result.dialogKeys = dialogLayer?.commands.map((command) => command.bind)
  const opened = calls.length
  ;(result.listeners as Record<string, number>).whileOpen = listening()

  // Refreshes while open: r, granola's MCP status, server.connected, agent, integration and credential changes, and a finished turn; other servers do not.
  dialogLayer?.commands.find((command) => command.bind === "r")!.run()
  emit("mcp.status.changed", { data: { server: "github" } })
  emit("mcp.status.changed", { data: { server: "granola" } })
  emit("server.connected", { data: {} })
  emit("agent.updated", { data: {} })
  emit("integration.updated", { data: {} })
  emit("credential.updated", { data: {} })
  emit("credential.switched", { data: {} })
  emit("session.idle", { data: {} })
  await settle()
  const whileOpen = calls.length - opened
  dialogLayer?.commands.find((command) => command.bind === "escape")!.run()
  await screen.dispose()
  dialog.onClose?.()
  ;(result.listeners as Record<string, number>).afterClose = listening()
  emit("agent.updated", { data: {} })
  await settle()
  result.refresh = { beforeOpen, opened, whileOpen, afterClose: calls.length - opened - whileOpen }
  result.cleared = cleared
  result.rpc = calls[0]

  await cleanup?.()
  result.listenersAfterCleanup = [...listeners.values()].reduce((sum, set) => sum + set.size, 0)
  return result
}

const results: Record<string, unknown> = {}
for (const [name, scenario] of Object.entries(SCENARIOS)) results[name] = await run(scenario)
console.log(`RESULT ${JSON.stringify(results)}`)
