import type { Plugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"
import { Granola, type Status } from "../rpc/contract.js"
import { SERVER, STATUS_SLASH, view, type Details } from "./model.js"
import { StatusDialog } from "./view.js"

/** Client RPC failures carry a type; these two mean no server part answers for the contract. */
function reason(error: unknown): string {
  const type = typeof error === "object" && error !== null && "type" in error ? error.type : undefined
  return type === "rpc.unavailable" || type === "rpc.method_not_found"
    ? "the Granola plugin is not running on this OpenCode server"
    : "the status request failed"
}

const plugin: Plugin.Definition = {
  id: "granola.meetings.tui",
  setup(context) {
    const [details, setDetails] = createSignal<Details>({ type: "loading" })
    // Only the newest request may update the view; closing the dialog and cleanup also move it on.
    let generation = 0
    // Identifies the open dialog; showing another dialog closes this one.
    let open: object | undefined
    let disposed = false
    // Event listeners, held only while the dialog is open.
    let stops: (() => void)[] = []

    const refresh = () => {
      if (!open) return
      const request = ++generation
      void context.client.rpc(Granola).status({}, context.location ? { location: context.location } : {})
        // The server validates the output against the contract's schema before it answers.
        .then((status): Details => ({ type: "ready", status: status as Status }), (error: unknown): Details => ({ type: "unavailable", reason: reason(error) }))
        .then((next) => {
          if (request === generation) setDetails(next)
        })
    }

    const close = () => {
      open = undefined
      generation++
      for (const stop of stops) stop()
      stops = []
    }

    const show = () => {
      if (disposed) return
      close()
      const token = {}
      setDetails({ type: "loading" })
      context.ui.dialog.show(
        () => <StatusDialog context={context} view={view(details())} refresh={refresh} />,
        () => {
          if (open === token) close()
        },
      )
      context.ui.dialog.set({ size: "large" })
      open = token
      stops = [
        context.data.on("server.connected", refresh),
        context.data.on("mcp.status.changed", (event) => {
          if (event.data.server === SERVER) refresh()
        }),
        // Agents defined only in user config change which agents miss the permission defaults.
        context.data.on("agent.updated", refresh),
        context.data.on("integration.updated", refresh),
        context.data.on("credential.updated", refresh),
        context.data.on("credential.switched", refresh),
        // An account read during a turn names the workspace; the dialog picks it up when the turn ends.
        context.data.on("session.idle", refresh),
      ]
      refresh()
    }

    // Registered from setup, outside any root of the plugin's own, where OpenCode's keymap is available.
    // Global, so the palette, which runs in its own input mode, lists the command.
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        { id: "granola.status", title: "Granola: Status", group: "Granola", palette: true, slash: { name: STATUS_SLASH }, run: show },
      ],
    }))

    return () => {
      disposed = true
      close()
    }
  },
}

export default plugin
