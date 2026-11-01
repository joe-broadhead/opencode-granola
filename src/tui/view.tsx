import type { Plugin } from "@opencode/plugin/tui"
import { For, Show } from "solid-js"
import type { Tone, View } from "./model.js"

type Theme = Plugin.Context["theme"]

function color(theme: Theme, tone: Tone | undefined) {
  switch (tone) {
    case "ok":
      return theme.text.feedback.success.base
    case "warning":
      return theme.text.feedback.warning.base
    case "error":
      return theme.text.feedback.error.base
    case "info":
      return theme.text.muted
    case undefined:
      return theme.text.base
  }
}

/** The status dialog. Its keys live in a layer created here, so OpenCode removes them when the dialog closes. */
export function StatusDialog(props: { readonly context: Plugin.Context; readonly view: View; readonly refresh: () => void }) {
  props.context.keymap.layer(() => ({
    mode: "modal",
    commands: [
      { title: "Refresh Granola status", group: "Granola", bind: "r", run: () => props.refresh() },
      { title: "Close Granola status", group: "Granola", bind: "escape", run: () => props.context.ui.dialog.clear() },
    ],
  }))
  const theme = (): Theme => props.context.theme.surface("dialog")
  return (
    <box flexDirection="column" gap={1} paddingLeft={2} paddingRight={2} paddingBottom={1}>
      <text fg={theme().text.base}>
        <b>Granola status</b>
      </text>
      <Show when={props.view.rows.length}>
        <box flexDirection="column">
          <For each={props.view.rows}>
            {(row) => (
              <box flexDirection="column">
                <box flexDirection="row" gap={1}>
                  <text fg={theme().text.muted} width={14} flexShrink={0}>{row.label}</text>
                  <text fg={color(theme(), row.tone)} flexGrow={1} wrapMode="word">{row.text}</text>
                </box>
                <Show when={row.block}>
                  {(block: () => readonly string[]) => (
                    <box flexDirection="column" paddingLeft={15}>
                      <For each={block()}>{(line) => <text fg={theme().text.muted}>{line}</text>}</For>
                    </box>
                  )}
                </Show>
              </box>
            )}
          </For>
        </box>
      </Show>
      <box flexDirection="row" gap={1}>
        <text fg={theme().text.muted} width={14} flexShrink={0}>Next step</text>
        <text fg={theme().text.base} flexGrow={1} wrapMode="word">{props.view.next}</text>
      </box>
      <text fg={theme().text.muted}>{"r refresh · esc close"}</text>
    </box>
  )
}
