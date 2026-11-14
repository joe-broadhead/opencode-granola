# In Jelly

[Jelly](https://heyjelly.ai) runs OpenCode agents. It reads the `jelly` section of this
package's `package.json` as JSON, without loading the plugin, when a person reviews the exact
version, and uses it as follows.

Jelly names the plugin **Granola** (`jelly.title`), with the package name and version beneath. Under
that name it shows the one line in `jelly.summary`, and beside it the mark in `jelly.icon`
(`assets/icon.svg`, shipped in the package): Jelly reads that file once, when it records the
plugin, and keeps it only if it is a clean SVG of drawing elements, with no script, style, link
or outside reference. A Jelly whose declaration schema lacks `summary` or `icon` refuses this
declaration, because that schema accepts no unknown keys.

## Tools and permissions

21 tools are declared (11 read-only). Jelly's agents have no base "allow everything"
rule, so this plugin's own default rules, which it puts after that rule, never reach them. Jelly
writes each declared `ask` or `deny` as that tool's default instead (the person's own choice
replaces it), and denies a read-only helper every tool not marked `readOnly`. A declared `allow`
changes nothing in Jelly.

- Ask: none. Every tool is allowed by default, in Jelly as in OpenCode.
- Off: none.
- Everything else runs, as the plugin's own rules let it. That includes `granola_give_feedback`, which sends a report to
  Granola's team and which Granola's own instructions tell the model to send unasked, and
  `granola_export_markdown`, which writes a file outside the project. A Jelly admin turns either into an ask, or off,
  in Jelly's own tool settings; in OpenCode the same is a rule, or the `access` option. `granola_events_list` is the plugin's own read for Memory's collector, which runs it unattended, so it never asks.

`granola_sign_out` is declared, not read-only, with a note: Granola serves it as a destructive change (it revokes the
sign-in for every connection that shares it), so a read-only helper is never given it. The plugin removes it from the
agents' tools in OpenCode and in Jelly alike; sign out from the card, or with `opencode mcp logout granola`.
`granola_create_meeting_note_from_transcript` is one of Granola's writes: it creates a private note.

A tool the upstream server adds later is not declared, so in Jelly it is not asked about by
default. Keep `jelly.tools` in step with the known-tool list; `test/jelly.test.ts` checks
each declared effect against the plugin's own default rules, and the list against the known tools.
`test/live-tools.test.ts` checks the declaration against Granola's own tool list, captured live on 14 November 2026
in `test/fixtures/live-tools.json` (`provenance.json` says how): every tool Granola serves is declared, every declared
tool is served or is the plugin's own (`test/fixtures/tool-registry.json`), and each `readOnly` is Granola's
`readOnlyHint`.

## Skills

Declared: `granola`, `granola-meeting-brief`. Jelly refuses an install whose
skill ids collide with another plugin's or the agent's own.

## Views and scripts

None: `jelly.views` and `jelly.rpc` are empty.

## Signing in

`jelly.signIns` declares one sign-in, `granola`, for Granola's MCP server `granola`, which signs in with OpenCode's MCP OAuth. When the server needs a new sign-in, the row says Sign in again. OpenCode can keep reporting a server whose token was turned down mid-session as connected until it connects again; Jelly has the engine reconnect it when a call fails that way.

Jelly folds the declared sign-ins into this plugin's one card, which shows each as Connected, Not signed in or Sign in again (expired or revoked), and starts, renews and signs out of each. An agent's `jelly_connection_request`, or a tool result that names this plugin's "Run /connect and choose …" next step, opens the same card. The plugin still signs in through OpenCode, as it does without Jelly; the declaration only tells Jelly which of the engine's integrations and servers are this plugin's.

## Settings

`jelly.contributes.settings` declares one setting, `access`, the option of the same name, as a choice of three:
**Allowed** (`all`, the default), **Ask before changes** (`ask-changes`) and **Read only** (`read-only`), with Jelly's
own line for each. Jelly draws it as a choice, never as free text, and saves only one of the three. A Jelly that does
not know declared choices yet refuses the whole declaration, so this needs a Jelly that does.

`exportDirectory`, an absolute path, and `allowUntestedHost` are not declared: they are set in `opencode.json`.

## Versions

Jelly's curated catalogue pins an exact version. Each release is published under a new version, so a review in
Jelly can tell the two apart.

The declaration test runs the shared kit, `test/support/jelly-kit.ts`, which checks the declaration and this page against Jelly's plugin authors' standard. `scripts/check-copies.mjs` holds the kit, the shared part of the tools RPC (`src/host/tools-rpc.ts`) and the events_list source contract (`src/host/events-list.ts`) equal to the copies every plugin carries.
