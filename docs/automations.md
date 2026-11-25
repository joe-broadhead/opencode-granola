# Automations

An events source is read on a timer with a cursor in the automation's state. The manifest's `cadence.suggestMinutes` is
the suggested interval; a provider's own floor, when it states one, is the minimum.

<!-- generated:automations -->
| Source | Method | Provider floor | Suggested | Signals |
|---|---|---|---|---|
| `granola.meetings` | `tools.granola.events_list` | — | 5 min | — |
<!-- /generated:automations -->

## The recipe

A Granola automation reads `tools.granola.events_list`. The reader is in the tool's own result: the `granola.meetings`
feed lists meetings as events, oldest first.

1. Read `tools.granola.events_list` with the account and the cursor your state saved.
2. Apply the page's events, then save the `cursor` it answers, in the same state update.
3. If `failed` is not empty, keep the old cursor: a failed event holds the read back. `refused` does not; those items
   will never be delivered.
4. Read again on the suggested cadence. `more: true` means another page is ready now, not that the source is done.

```ts
// The automation's state holds one cursor per account.
const page = await tools.granola.events_list({
  source: "granola",
  account: "work",
  cursor: state.cursor,
})
state.cursor = page.cursor
```

A cursor is bound to the plugin, source, account and scope. Do not share one between accounts: the plugin refuses it
with `CURSOR_INVALID`.

## Free plan and gap

Granola's free (Basic) plan shows only the last 30 days. Unless `probe` has read a paid plan for the account within the
last day, a listing that would start more than 29 days back answers `gap: { reason: "window-truncated", since }` once
and lists from inside the window. Treat the gap as a resync signal; the cursor moves past it, and later pages of that
read neither repeat the gap nor skip a meeting the plan still shows.

## Snapshot

`granola.meetings.list` is a snapshot of recent meeting titles, read with
`tools.granola.events_list({ source: "granola", account: "work", list: "meetings" })`. It is for a view that needs a
fresh list, not for a timer: a timer reads the events source, which carries a cursor.
