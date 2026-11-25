# Changelog

## 0.0.0 (2026-11-25)

- Rebuilt greenfield on plugin-contract v0: one `register` call, `status` through `statusAnswer`, `probe`,
  `events_list` and `export_markdown`, and every reachable Granola MCP tool (all but the hidden `sign_out`) declared as a pass-through method with its class.
- The bundled skills `granola` and `granola-meeting-brief` are registered at setup through `ctx.skill.transform`, so
  OpenCode loads them after install; the contract's `register` does not register skills.
- Accounts through the `accounts` module: one remote MCP server per alias, `granola` and `granola-<alias>`, each with
  its own OAuth session.
- Two sources, `granola.meetings` (events) and `granola.meetings.list` (a list snapshot), private and free.
- No bus events: the plugin's own write is a local Markdown file, and pass-through writes are executed by Granola's MCP
  server.

**Removed since v0.0.10:**

- The `/granola-status` command. The contract's `status` method reports the plugin's version, OpenCode host,
  per-account state and next step as `tools.granola.status` and over RPC; the 4b rewrite dropped the command.
- The `/granola` TUI dialog. The rewrite has no TUI entry (`./tui` was not carried over); `status` is the replacement,
  readable as a tool and over RPC.
- The RPC ids `granola.meetings` (old status) and `granola.meetings.tools` (the old scripting route for every
  Granola MCP tool plus `probe`, `events_list` and `export_markdown`). The contract's one RPC id `granola` serves the
  four plugin methods; the MCP tools stay OpenCode's own tools, reached through the tool namespace and Code Mode.
