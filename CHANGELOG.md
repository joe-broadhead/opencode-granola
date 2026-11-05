# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.5] - 2026-11-05

### Added

- Status names a skill of yours that takes the place of one of the plugin's own. OpenCode loads one skill per id, so
  a skill with the id `granola` or `granola-meeting-brief`, for example in `~/.config/opencode/skills/` or a
  project's `.opencode/skills/`, hides the plugin's. `/granola-status` and the `/granola` dialog have a new `Skills`
  row, the status RPC a new `shadowedSkills` field (`name` and `path`, empty when none), and the next step says to
  rename or move that file.

### Changed

- `give_feedback` is now denied by default, which hides it from the model; it used to ask. Granola's own instructions
  tell the model to send reports unasked, which put an unexplained prompt in front of you. To send reports, add
  `{ "action": "granola_give_feedback", "resource": "*", "effect": "ask" }` to your `permissions`. The default rule
  block ends with the deny, the `Access` row says so, and the `jelly` declaration gives `granola.give_feedback` the
  effect `deny`.
- The next step for agents without the default rules is now the same in every plugin of this family: "Put the
  default rules shown by /granola-status first in each listed agent's own permissions, in opencode.json or the
  agent's Markdown file, followed by your top-level rules for Granola tools." The `Agents without default rules` row
  lists only the agents' names, followed by the rules to paste.
- Scripts: when a deny rule refuses a tools RPC call, `PERMISSION_DENIED` names the action it refused, and its next
  step says to remove or narrow that rule, or to use a session whose agent allows it.
- `EXPORT_INVALID_INPUT` gives the next step for the part of the request that was wrong: an unknown field, `path`,
  `overwrite`, or `meeting_ids` and `content`.
- The `export_markdown` description states the 8 MB limit, that a plan without transcripts gets the notes instead,
  and that the text result names anything missing.
- Both skills are rewritten, shorter, around the choices agents got wrong: `search_transcripts` first for what was
  said, then only the matching transcript chunks; call shapes for the main tools; paraphrasing instead of quoting;
  labelling Granola's summaries as Granola's; and citing each meeting's note link. The `granola-meeting-brief` skill
  gets an upcoming meeting from a calendar tool or asks, because Granola holds only past meetings, and builds the
  brief from the meeting's own record unless you ask for other sources.
- The Granola namespace description, which the model always sees, now carries those rules too.

### Fixed

- `query_granola_meetings` takes the meetings to search as `document_ids` and ignores `meeting_ids` without an error,
  so an answer meant for chosen meetings came from all of them. The skills and the namespace description now say
  to pass `document_ids`.
- The `granola` skill no longer points at `docs/scripting.md`, which the package does not ship; it links the guide
  on GitHub.

## [0.0.4] - 2026-11-04

### Added

- Jelly shows the plugin's one-line summary and icon. The package declares them in its `jelly` section and ships the
  icon as `assets/icon.svg`.

## [0.0.3] - 2026-11-04

### Added

- A `jelly` section in `package.json`, which [Jelly](https://heyjelly.ai) reads without loading the plugin:
  - Granola's 10 reads (they run), its 7 writes and `export_markdown` (they ask), each with its permission and
    whether it only reads, so that Jelly's agents, which have no base allow rule for the plugin's default rules to
    follow, still ask before a write;
  - the skill ids, the name Jelly shows on the plugin's card, and the `granola` server's sign-in.

  [docs/jelly.md](https://github.com/joe-broadhead/opencode-granola/blob/HEAD/docs/jelly.md) explains each part.

## [0.0.2] - 2026-11-04

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
- On a release inside `>=2.2.3 <2.3.0` other than 2.2.3, 2.2.4 and 2.2.5, Granola still sets everything up, and only
  the `OpenCode` row calls the version untested. The row reads, for example,
  `2.2.5 (tested; supported range >=2.2.3 <2.3.0), plugin <version>`. On a host outside the range that runs because
  of `allowUntestedHost`, the next step, when nothing else is needed, says to use a tested release if Granola
  misbehaves.
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
- The README's sign-in check quoted a status line that does not exist. It now says the `Connection` row shows
  `connected` and the `Tools` row how many Granola tools are available.
- The README said Explore is left unchanged. Explore and Title also get the block; their own later deny rules still
  keep Granola's tools out.
- The README's Uninstall now says why to sign out first: once the plugin is removed, `opencode mcp logout granola`
  answers "MCP server not found" and the sign-in stays in OpenCode's credential store. It signs out, checks with
  `opencode auth list`, then removes the plugin, reloads, and checks with `opencode mcp list`.
- The README now says what to do after `opencode plugin add` (run `opencode reload`, then `/granola-status`), how to
  update the plugin, and, under Troubleshooting, that Granola's free plan returns only the last 30 days of meetings.
- `docs/scripting.md` said `opencode api` runs in the directory you call it from. It runs in the OpenCode service's
  default location, your home directory; the doc now says how to target a project. It also says that `opencode api`
  exits with status 1 for an RPC error, and that a result with only text has that text as its `output`.
- The `granola` skill now names the `folder_id` filter of `search_meetings` and `list_meetings`.
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
