# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- OpenCode 2.2.5 is a tested release, next to 2.2.3 and 2.2.4.
- The status RPC (`granola.meetings` `status`) has `version`, the plugin's version, and `host.range` and
  `host.tested`. A status it cannot read is now the RPC error `unavailable` with `STATUS_UNAVAILABLE` and its next
  step, and the `/granola` dialog says so.

### Changed

- The status RPC uses the field names every plugin of this family shares. Scripts that read it need these changes:
  - `next` is now `nextStep`;
  - `pluginVersion` is now `version`;
  - `hostVersion` is now `host.version`, which is `null` when OpenCode reports no version;
  - `state` uses the shared states: `pending` is now `connecting`, `needs_auth` is now `sign_in_required`, `absent`
    is now `not_configured`, and the user's own `granola` server for another URL is now `conflict` (it was that
    server's connection state, next to `conflict`);
  - `problem` no longer has `next`: the one next step is `nextStep`;
  - `tools.visible` counts every Granola tool the model can call, unknown ones included.
- On a release inside `>=2.2.3 <2.3.0` other than 2.2.3, 2.2.4 and 2.2.5, Granola still sets everything up; status
  calls the version untested and, when nothing else is needed, says to use a tested release if Granola misbehaves.
  The `OpenCode` row reads, for example, `2.2.5 (tested; supported range >=2.2.3 <2.3.0), plugin <version>`.
- Status always shows the `Agents without default rules` row, with `none` when no agent needs the fix. It lists an
  agent only when its own rules would let a Granola tool this plugin does not know run without asking; an agent
  whose rules already ask or deny for every Granola tool is not listed.
- The sign-in next step says to press `o` or Enter to open the sign-in page. A disabled server's next step offers
  `/mcps` first. A missing server's next step points at an organisation policy (`mcp.use`) or another plugin that
  removes it, not at the plugins list.
- The tools RPC's `describe` takes no input: anything but `{}` or nothing now gets `describe takes no input`. An
  envelope that is not an object gets `the envelope must be an object, such as {…}`.
- A refused permission check now names the action that was refused, when it is not the method's own.

### Fixed

- A failed connection's reason no longer ends in doubled punctuation, as in `…access the url?.`.
- A script's call that found Granola disconnected, while Granola reads connected again by the time the plugin looks,
  now gets `CONNECTING` and "Retry in a few seconds.", as the model does. It got `CONNECTION_FAILED` and a reconnect
  step before.

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
