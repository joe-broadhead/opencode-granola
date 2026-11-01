# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.0] - 2026-11-01

### Added

- Registers Granola's official MCP server, `https://mcp.granola.ai/mcp`, under the name `granola`, so Granola's own
  tools appear as `granola_<tool>` (`tools.granola.<tool>` in Code Mode). An existing `mcp.servers.granola` entry is
  never overwritten; status reports one that points at another server.
- Sign-in through `/connect`, where the server is listed as Granola, or `opencode mcp auth granola`. `/connect` shows
  "Sign in required" when Granola rejects the stored sign-in.
- Default permission rules, inserted into every agent directly after its base allow rule: `granola_*` asks, and
  Granola's ten known reads are allowed. Your `permissions` and saved "Always allow" answers override them, and
  agents without a base allow, such as Explore, keep their own rules.
- Granola's `sign_out` tool is hidden; sign out with `opencode mcp logout granola`.
- The `export_markdown` tool, which saves the notes, transcripts or both of 1 to 20 meetings to one Markdown file
  after a permission prompt. Inputs `meeting_ids`, `content`, `path` and `overwrite`; files of at most 8 MB, written
  atomically with mode `0600`. Without transcripts on the Granola plan, the file holds the notes and says so.
- `/granola-status`, which shows the connection, workspace, tools, agents without the default rules with the block to
  paste, the host check and the next step.
- A terminal UI status dialog: the palette entry "Granola: Status" and `/granola`. It reads the read-only RPC method
  `granola.meetings/status`.
- The skills `granola` and `granola-meeting-brief`.
- Options `exportDirectory` (default `Granola` in the home folder) and `allowUntestedHost` (default `false`).
- A host check that refuses OpenCode outside `>=2.2.3 <2.3.0` with `HOST_UNTESTED`, unless
  `allowUntestedHost` is set. Every error carries a code, a message and one next step.
