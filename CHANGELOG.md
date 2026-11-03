# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A `jelly` section in `package.json`: each tool with its permission, its default effect and whether it only reads, the skill ids. Jelly reads it without loading the plugin and applies the declared asks, because its agents have no base allow rule for this plugin's own default rules to follow. `docs/jelly.md` explains it.
- `title` and `signIns` in the `jelly` section: the name Jelly shows on the plugin's card, and what the plugin signs in to, so that one card can say whether each sign-in is connected and start, renew or end it. `docs/jelly.md` lists them.

## [0.0.1] - 2026-11-03

### Added

- The tools RPC, `granola.meetings.tools`: a script can call Granola's ten read tools with no model, through
  `opencode api`, as a session and its agent. It gets exactly the access that agent's model has: a tool its rules hide
  is refused, OpenCode checks each call against the agent's and the session's rules, and an ask is refused at once
  because no one is there to answer it. `describe` lists the methods with each tool's live input schema. Granola's
  writes, `sign_out`, `export_markdown` and any tool Granola adds later are never methods. An account read records the
  workspace for status, and a server that is not connected gets the same codes and next steps as for the model.
  `docs/scripting.md` explains it.

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
