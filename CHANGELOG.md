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
