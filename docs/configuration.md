# Configuration

This page covers the plugin options, the permission rules and how to change them, Markdown exports, runs where nobody
is present, and every error code. The [README](../README.md) covers install, sign-in and everyday use.

## Plugin options

Options go in the plugin's entry in `plugins`. Both are optional.

```jsonc
{
  "plugins": [
    {
      "package": "@joe-broadhead/opencode-granola",
      "options": {
        "exportDirectory": "<an absolute path>/Granola",
        "allowUntestedHost": false
      }
    }
  ]
}
```

| Option | Default | Meaning |
| --- | --- | --- |
| `exportDirectory` | `Granola` in your home folder | Where `export_markdown` writes files. It must be an absolute path; write out your home folder instead of `~`. The folder is created on the first approved export. |
| `allowUntestedHost` | `false` | `true` lets the plugin run on an OpenCode version outside the supported range (`>=2.2.3 <2.3.0`). Status then shows a warning. See [Host check](#host-check). |
| `access` | `"all"` | What the default permission rules allow: `"all"` (every tool), `"ask-changes"` (reads run, everything else asks) or `"read-only"` (reads run, everything else is denied). See [Permissions](#permissions). |

The options are checked strictly when the plugin starts. An unknown key or a wrong type stops the plugin with one error
that names the key, for example:

```text
OPTIONS_INVALID: Plugin option exportDir is not supported; use exportDirectory, allowUntestedHost, access. Next step: Fix the Granola plugin options in your OpenCode config, then reload OpenCode.
```

Permissions are configured with OpenCode's own `permissions` rules, as below.

## Permissions

### How OpenCode runs Granola's tools

Each of Granola's tools appears as `granola_<tool>` (`tools.granola.<tool>` in Code Mode). Before a call, OpenCode
checks the permission action `granola_<tool>` with the resource `*`. The plugin's own tool uses the same naming:
`granola_export_markdown`. For an export, the resource is the file's path inside the export
folder.

Every OpenCode agent starts from a rule that allows everything. Without the plugin's rules, every Granola tool,
including the ones that change things in Granola, would run without asking.

### The default rules

**Every tool is allowed by default.** At `access: "all"` (the default), the plugin inserts this block into every agent
that has the base "allow everything" rule, directly after that rule:

```json
[
  { "action": "granola_*", "resource": "*", "effect": "allow" },
  { "action": "granola_get_account_info", "resource": "*", "effect": "allow" },
  { "action": "granola_list_meeting_folders", "resource": "*", "effect": "allow" },
  { "action": "granola_list_meetings", "resource": "*", "effect": "allow" },
  { "action": "granola_search_meetings", "resource": "*", "effect": "allow" },
  { "action": "granola_get_meetings", "resource": "*", "effect": "allow" },
  { "action": "granola_get_meeting_transcript", "resource": "*", "effect": "allow" },
  { "action": "granola_query_granola_meetings", "resource": "*", "effect": "allow" },
  { "action": "granola_get_meeting_attachment", "resource": "*", "effect": "allow" },
  { "action": "granola_list_templates", "resource": "*", "effect": "allow" },
  { "action": "granola_search_transcripts", "resource": "*", "effect": "allow" },
  { "action": "granola_events_list", "resource": "*", "effect": "allow" },
  { "action": "granola_create_folder", "resource": "*", "effect": "allow" },
  { "action": "granola_update_folder", "resource": "*", "effect": "allow" },
  { "action": "granola_add_note_to_folder", "resource": "*", "effect": "allow" },
  { "action": "granola_remove_note_from_folder", "resource": "*", "effect": "allow" },
  { "action": "granola_update_private_notes", "resource": "*", "effect": "allow" },
  { "action": "granola_generate_summary", "resource": "*", "effect": "allow" },
  { "action": "granola_give_feedback", "resource": "*", "effect": "allow" },
  { "action": "granola_export_markdown", "resource": "*", "effect": "allow" }
]
```

or, at `access: "ask-changes"`, this one:

```json
[
  { "action": "granola_*", "resource": "*", "effect": "ask" },
  { "action": "granola_get_account_info", "resource": "*", "effect": "allow" },
  { "action": "granola_list_meeting_folders", "resource": "*", "effect": "allow" },
  { "action": "granola_list_meetings", "resource": "*", "effect": "allow" },
  { "action": "granola_search_meetings", "resource": "*", "effect": "allow" },
  { "action": "granola_get_meetings", "resource": "*", "effect": "allow" },
  { "action": "granola_get_meeting_transcript", "resource": "*", "effect": "allow" },
  { "action": "granola_query_granola_meetings", "resource": "*", "effect": "allow" },
  { "action": "granola_get_meeting_attachment", "resource": "*", "effect": "allow" },
  { "action": "granola_list_templates", "resource": "*", "effect": "allow" },
  { "action": "granola_search_transcripts", "resource": "*", "effect": "allow" },
  { "action": "granola_events_list", "resource": "*", "effect": "allow" },
  { "action": "granola_create_folder", "resource": "*", "effect": "ask" },
  { "action": "granola_update_folder", "resource": "*", "effect": "ask" },
  { "action": "granola_add_note_to_folder", "resource": "*", "effect": "ask" },
  { "action": "granola_remove_note_from_folder", "resource": "*", "effect": "ask" },
  { "action": "granola_update_private_notes", "resource": "*", "effect": "ask" },
  { "action": "granola_generate_summary", "resource": "*", "effect": "ask" },
  { "action": "granola_give_feedback", "resource": "*", "effect": "ask" },
  { "action": "granola_export_markdown", "resource": "*", "effect": "ask" }
]
```

or, at `access: "read-only"`:

```json
[
  { "action": "granola_*", "resource": "*", "effect": "deny" },
  { "action": "granola_get_account_info", "resource": "*", "effect": "allow" },
  { "action": "granola_list_meeting_folders", "resource": "*", "effect": "allow" },
  { "action": "granola_list_meetings", "resource": "*", "effect": "allow" },
  { "action": "granola_search_meetings", "resource": "*", "effect": "allow" },
  { "action": "granola_get_meetings", "resource": "*", "effect": "allow" },
  { "action": "granola_get_meeting_transcript", "resource": "*", "effect": "allow" },
  { "action": "granola_query_granola_meetings", "resource": "*", "effect": "allow" },
  { "action": "granola_get_meeting_attachment", "resource": "*", "effect": "allow" },
  { "action": "granola_list_templates", "resource": "*", "effect": "allow" },
  { "action": "granola_search_transcripts", "resource": "*", "effect": "allow" },
  { "action": "granola_events_list", "resource": "*", "effect": "allow" },
  { "action": "granola_create_folder", "resource": "*", "effect": "deny" },
  { "action": "granola_update_folder", "resource": "*", "effect": "deny" },
  { "action": "granola_add_note_to_folder", "resource": "*", "effect": "deny" },
  { "action": "granola_remove_note_from_folder", "resource": "*", "effect": "deny" },
  { "action": "granola_update_private_notes", "resource": "*", "effect": "deny" },
  { "action": "granola_generate_summary", "resource": "*", "effect": "deny" },
  { "action": "granola_give_feedback", "resource": "*", "effect": "deny" },
  { "action": "granola_export_markdown", "resource": "*", "effect": "deny" }
]
```

The block is generated from `defaultRules(access)` in `src/permissions.ts`, so it follows the tool lists and the option.
So:

- Granola's known reads run without a prompt at every `access` value.
- At the default `"all"`, every other tool runs too: Granola's writes (`create_folder`, `update_folder`,
  `add_note_to_folder`, `remove_note_from_folder`, `update_private_notes` and `generate_summary`), `give_feedback`
  (which sends a report to Granola's team, and which Granola's own instructions tell the model to send unasked), the
  plugin's `export_markdown`, and any Granola tool this plugin version does not know yet.
- `"ask-changes"` asks for those, and `"read-only"` denies them. A `deny` on `*` also hides the tool from the model.
- Explore and Title also get the block, but their own later deny rules still keep Granola's tools out. Plan keeps its
  own restrictions. An agent without the base rule gets no rules.

OpenCode applies the last rule that matches. Your top-level `permissions` come after the plugin's block in each agent,
an agent's own `permissions` come after those, and answers you saved with "Always allow" are checked last. So your
rules and saved answers override the defaults. A `deny` that you configure always wins, even over a saved answer.

These rules are the whole permission mechanism; approvals are configured only through OpenCode's own rules.

### Agents that miss the default rules

OpenCode creates agents that are defined only in your own config after plugins have started, so they do not get the
block. In those agents, the `access` option reaches nothing. `/granola-status` and the
status dialog list each such agent under "Agents without default rules" and give the fix. An agent is listed when it
has a base allow, lacks the block, and its own rules would let a Granola tool this plugin does not know run without
asking. An agent whose rules already ask or deny for every Granola tool needs no fix and is not listed. With no such
agent, the row reads `none`. The fix:

> Put the default rules shown by /granola-status first in each listed agent's own permissions, in opencode.json or
> the agent's Markdown file, followed by your top-level rules for Granola tools.

For example, for an agent `reviewer`, when your top-level `permissions` allow `granola_create_folder`:

```jsonc
{
  "permissions": [
    { "action": "granola_create_folder", "resource": "*", "effect": "allow" }
  ],
  "agents": {
    "reviewer": {
      "description": "Reviews meeting follow-ups",
      "mode": "primary",
      "permissions": [
        // The Granola permission block, as listed above:
        { "action": "granola_*", "resource": "*", "effect": "allow" },,
        { "action": "granola_get_account_info", "resource": "*", "effect": "allow" },,
        { "action": "granola_list_meeting_folders", "resource": "*", "effect": "allow" },,
        { "action": "granola_list_meetings", "resource": "*", "effect": "allow" },,
        { "action": "granola_search_meetings", "resource": "*", "effect": "allow" },,
        { "action": "granola_get_meetings", "resource": "*", "effect": "allow" },,
        { "action": "granola_get_meeting_transcript", "resource": "*", "effect": "allow" },,
        { "action": "granola_query_granola_meetings", "resource": "*", "effect": "allow" },,
        { "action": "granola_get_meeting_attachment", "resource": "*", "effect": "allow" },,
        { "action": "granola_list_templates", "resource": "*", "effect": "allow" },,
        { "action": "granola_search_transcripts", "resource": "*", "effect": "allow" },,
        { "action": "granola_create_folder", "resource": "*", "effect": "allow" },,
        { "action": "granola_update_folder", "resource": "*", "effect": "allow" },,
        { "action": "granola_add_note_to_folder", "resource": "*", "effect": "allow" },,
        { "action": "granola_remove_note_from_folder", "resource": "*", "effect": "allow" },,
        { "action": "granola_update_private_notes", "resource": "*", "effect": "allow" },,
        { "action": "granola_generate_summary", "resource": "*", "effect": "allow" },,
        { "action": "granola_give_feedback", "resource": "*", "effect": "allow" },,
        { "action": "granola_export_markdown", "resource": "*", "effect": "allow" },
        // Then your top-level rules for Granola tools, so they keep winning:
        { "action": "granola_create_folder", "resource": "*", "effect": "allow" }
        // Then the agent's other rules.
      ]
    }
  }
}
```

`/granola-status` prints the same block as JSON for the current `access`, ready to copy. Do not put the block in the
top-level `permissions`:
OpenCode adds top-level rules to every agent after its base rules, so the block would loosen agents such as Explore,
which otherwise deny Granola's tools.

### Recipes

Top-level `permissions` apply to every agent, Plan and Explore included. To change one agent only, put the rule in that
agent's own `permissions` instead.

Run one write without asking:

```json
{
  "permissions": [
    { "action": "granola_create_folder", "resource": "*", "effect": "allow" }
  ]
}
```

Refuse every known Granola write. A tool whose last matching rule is a `deny` on `*` is also hidden from the model.
Tools the plugin does not know yet, and exports, still ask.

```json
{
  "permissions": [
    { "action": "granola_create_folder", "resource": "*", "effect": "deny" },
    { "action": "granola_update_folder", "resource": "*", "effect": "deny" },
    { "action": "granola_add_note_to_folder", "resource": "*", "effect": "deny" },
    { "action": "granola_remove_note_from_folder", "resource": "*", "effect": "deny" },
    { "action": "granola_update_private_notes", "resource": "*", "effect": "deny" },
    { "action": "granola_generate_summary", "resource": "*", "effect": "deny" }
  ]
}
```

Refuse one tool:

```json
{
  "permissions": [
    { "action": "granola_generate_summary", "resource": "*", "effect": "deny" }
  ]
}
```

Turn Granola off for one agent, here `general`:

```json
{
  "agents": {
    "general": {
      "permissions": [
        { "action": "granola_*", "resource": "*", "effect": "deny" }
      ]
    }
  }
}
```

Allow exports without asking, including in runs where nobody is present:

```json
{
  "permissions": [
    { "action": "granola_export_markdown", "resource": "*", "effect": "allow" }
  ]
}
```

### Saved approvals

When OpenCode asks, "Always allow" saves the pattern `*` for that tool's action, for every path in the case of an
export. The saved answer applies to every agent in the OpenCode project, Plan included, until you remove it. See
[SECURITY.md](../SECURITY.md).

### Runs where nobody is present

In `opencode run`, schedules and other runs where nobody can answer a prompt, a call that would ask is refused as
needing approval, and the tool does not run. Granola's reads still work. To let such a run make a change
or write an export, allow that tool with a rule, as in the recipes above.

`opencode run --auto` approves every request that no rule denies, Granola's writes included. Prefer rules for the
tools you need.

## Markdown export

`export_markdown` (`granola_export_markdown`, or `tools.granola.export_markdown` in Code Mode) writes the notes, the
transcripts, or both, of 1 to 20 meetings into one Markdown file. It reads them through OpenCode's own
`granola_get_meetings` and `granola_get_meeting_transcript` tools, so the text goes from Granola to the file without
passing through the conversation.

### Input

| Field | Required | Meaning |
| --- | --- | --- |
| `meeting_ids` | yes | 1 to 20 Granola meeting IDs or note IDs. The file keeps this order. |
| `content` | yes | `notes` (your notes, Granola's AI summary and attendees), `transcript`, or `both`. |
| `path` | no | A path inside the export folder, such as `meetings/weekly-sync.md`. Missing folders are created and `.md` is added when absent. Default: a new name with the date and time, such as `granola-notes-20261030-140509Z.md`. |
| `overwrite` | no | `true` replaces an existing file. Default `false`. |

```js
await tools.granola.export_markdown({ meeting_ids: ["<meeting id>"], content: "both", path: "meetings/weekly-sync.md" })
```

It returns the file's absolute `path`, its size in `bytes` and its `sha256` checksum, plus a short summary that names
anything missing, such as a meeting without a transcript.

### What gets written

The file starts with front matter (`source`, `retrieved_at`, `content`, and each meeting's `id`, `title` and `url`
when Granola returns them), then a heading and a note that meeting content is untrusted text. Each meeting follows in
order, with its notes and transcript. Transcripts are read page by page until they are complete.

- When your Granola plan does not include transcripts, the export still succeeds. `both` writes the notes, and
  `transcript` writes the notes instead; each meeting's transcript section says that transcripts are not available on
  your Granola plan.
- An ID that Granola does not know gets a section that says so, with Granola's hint, instead of failing the export.
- The file is at most 8 MB. When a transcript reaches the limit, it stops with a note, and later transcripts are left
  out with a note. Export fewer meetings to get the rest.
- The export folder and any folders the export creates get mode `0700`. The file gets mode `0600`.
- The file is written atomically: it appears complete or not at all. Without `overwrite`, an existing file is never
  replaced.
- Paths that are absolute, start with `~`, use `\`, contain `..`, name hidden files or folders, or go through a link
  are refused before anything is read.

### Permission

**The export folder is outside the project**, by default `Granola` in your home folder, so OpenCode asks for
`external_directory` as well as the export's own action before anything is written. A rule for `granola_export_markdown`
alone is not enough where nobody is present: allow both, with the export folder's path:

```json
{
  "permissions": [
    { "action": "granola_export_markdown", "resource": "scheduled/*", "effect": "allow" },
    { "action": "external_directory", "resource": "/home/someone/Granola/scheduled/*", "effect": "allow" }
  ]
}
```

A refusal that names `external_directory` costs nothing: nothing is read and nothing is written, and the error's next
step gives that rule. Point `exportDirectory` inside the project to avoid it.

The export is allowed by the default block, so it runs without a prompt, and the path it will write is in its result.
With `access: "ask-changes"`, or a rule that asks, the prompt shows the path inside the export folder; if you reject
it, nothing is read and nothing is written. If a meeting cannot be read, nothing is written.

To export without a prompt, allow the action `granola_export_markdown` with a rule. The resource is the path inside the
export folder, so a rule can cover one folder:

```json
{
  "permissions": [
    { "action": "granola_export_markdown", "resource": "scheduled/*", "effect": "allow" }
  ]
}
```

A folder rule like this covers exports that the model or a direct tool call makes into that folder. Schedules and Code
Mode programs that run with nobody present are checked for every path, so they need `"resource": "*"`, as in the
recipe above.

## Events list

`granola_events_list` (`tools.granola.events_list` in Code Mode, and the tools RPC method `events_list`) is Granola's
side of Memory's sources funnel: the shared `events_list` contract, `src/host/events-list.ts`, which every source
plugin carries unchanged. It lists the meetings you took part in since a cursor, as normalised events, oldest first.
It only reads, never asks and calls no model, so Memory's collector can run it unattended.

```
events_list({ since?, cursor?, limit?, account?, source? })
  → { source: "granola", account: "default", owner: { id, label }, events, cursor, more, trust: "untrusted" }
```

| Input | Meaning |
| --- | --- |
| `since` | Where to start without a cursor: an ISO date (a UTC day) or date-time with `Z` or an offset. Default: 24 hours ago. |
| `cursor` | The previous result's cursor. It wins over `since`. |
| `limit` | Most events, 1 to 500; 100 by default. A result also stops before 900,000 bytes of JSON. |
| `account` | `default`, Granola's one account. |
| `source` | `granola`, the one source. |

How it reads, through OpenCode's own Granola tools, each with its own permission:

- `get_account_info` names the owner: `mailto:` and the signed-in email. The cursor holds a digest of it, so after
  a sign-in to another account an old cursor is refused.
- `search_meetings`, one week at a time, with `from_date` and `to_date` as UTC times and `attended_only: true`:
  the meetings you captured or are listed on. Every page of a week is read, because Granola lists newest first.
  Granola's server no longer offers `list_meetings`, so search with no keywords is its browse path.
- `get_meetings`, up to 10 at a time, for each listed meeting's start, link, attendees and AI summary.

Each event is one meeting: kind `meeting`, the meeting ID, its start (`meeting_at`), its title, attendees as actors
(`mailto:` and the email, or `name:` and the name when Granola has no email), Granola's AI summary cut to 4,096
characters, and its link. Private notes and transcripts are not read. A meeting is listed once it started 2 hours ago,
so its notes are most likely done; a meeting whose notes change afterwards is not listed again. The cursor is the
(start, ID) of the last meeting listed: calling again with it lists what follows, and an older cursor lists the same
meetings again.

The default rules allow `granola_events_list`. Its reads, `granola_get_account_info`, `granola_search_meetings` and
`granola_get_meetings`, must be allowed too for the agent of the session that runs it.

## Host check

When it loads, the plugin compares the OpenCode version with its supported range, `>=2.2.3 <2.3.0`, which
`package.json` declares as `opencode.host`. Every check runs on OpenCode 2.2.3, 2.2.4, 2.2.5 and 2.2.6, the tested releases.

- **A tested release:** the plugin sets everything up. The `OpenCode` row reads, for example,
  `2.2.5 (tested; supported range >=2.2.3 <2.3.0), plugin <version>`.
- **Another release inside the range, such as 2.2.99:** the plugin sets everything up too. The `OpenCode` row calls the
  version `untested` (the RPC's `host.tested` is `false`); the state and the next step are the same as on a tested
  release.
- **Outside the range, including prereleases and development builds:** the plugin does not start, with
  `HOST_UNTESTED`.
- **Outside the range with `"allowUntestedHost": true`:** the plugin sets everything up, and the `OpenCode` row says
  `host untested`. When nothing else is needed, the next step reads
  `If Granola misbehaves, use OpenCode 2.2.3, 2.2.4, 2.2.5 or 2.2.6.`

The plugin has no status-only mode: outside the range it does not start at all, so its status never has the state
`host_untested`.

## Status and RPC

`/granola-status`, the TUI `/granola` dialog and the RPC method `status` (RPC ID `granola.meetings`) share one status
model. It reads only OpenCode's local state and holds no token and no sign-in link. `version`, `host`, `state`,
`unguardedAgents` and `nextStep` are the fields every plugin of this family shares, with the same names and meanings:

| Field | Content |
| --- | --- |
| `version` | The plugin's version |
| `host` | `version` (`null` if OpenCode reports none), `range` (the supported range) and `tested` (true only for 2.2.3, 2.2.4, 2.2.5 and 2.2.6) |
| `state` | `connected`, `sign_in_required`, `connecting`, `disabled`, `failed`, `not_configured` or `conflict`. The text surfaces show the same states as `connected`, `sign-in required`, `connecting`, `disabled`, `failed`, `not configured` and `conflict`. |
| `title` | Granola's display title, when connected |
| `problem` | `code` and `message`, whenever Granola is not connected and there is no conflict |
| `conflict` | With the state `conflict`: why the user's own `granola` server is not this plugin's |
| `tools` | `visible`: Granola's tools the model can call now, unknown ones included (not the plugin's export); `hidden`: tools the plugin removed, such as `sign_out`; `unknown`: tools this plugin version does not know; `unknownNames`: at most 20 of their names, only those made of lowercase letters, digits and `_` |
| `workspace` | The active workspace from the most recent account read in this OpenCode run |
| `access` | `all`, `ask-changes` or `read-only`: what the generated default rules allow |
| `unguardedAgents` | Agents that would run an unknown Granola tool without asking; empty when there are none |
| `permissionsBlock` | With `unguardedAgents`: the rules for the current `access` to put first in each of those agents' own `permissions` |
| `shadowedSkills` | Skills OpenCode loads instead of the plugin's own because they use the same id, each with `name` (the plugin's skill) and `path` (the file that takes its place); empty when there are none |
| `exportDirectory` | The export folder |
| `hostWarning` | Only on a host outside the supported range that runs because of `allowUntestedHost` |
| `nextStep` | Exactly one next step: the `Next step` row, `Nothing to do.` when nothing is needed |

The text surfaces show the rows `Connection`, `Account`, `Access`, `Export folder`, `Skills`, `Tools`,
`Agents without default rules`, `OpenCode` and `Next step`, in that order, every row always there. The `Access` row
states what the `access` option allows. `Skills` reads
`the plugin's own`, or names each skill that takes the place of one of the plugin's. The RPC has one
error, `unavailable`, with `data: { code: "STATUS_UNAVAILABLE", next }`.

Scripts have a second RPC, `granola.meetings.tools`, which calls Granola's read tools with no model. It has its own
error codes; see [Scripting](scripting.md).

## Errors

Every error has a code, a message and a next step, in the form `CODE: message Next step: next step`.

### Connection and setup

| Code | Message | Next step |
| --- | --- | --- |
| `NOT_REGISTERED` | The Granola connection isn't registered yet. | Retry in a few seconds; if it persists, check that no organisation policy (mcp.use) or other plugin removes the granola server, then restart OpenCode. |
| `CONNECTING` | Granola is still connecting. | Retry in a few seconds. |
| `AUTH_REQUIRED` | Granola needs you to sign in. | Run /connect and choose Granola, then press o or Enter to open the sign-in page (in a terminal, opencode mcp auth granola opens it automatically). |
| `CONNECTION_FAILED` | Granola connection failed: *reason*, ending with one full stop, question mark or exclamation mark. | Reconnect Granola from /mcps, and if it keeps failing, run /connect and choose Granola to sign in again. |
| `DISABLED` | Granola is disabled in OpenCode. | Enable granola in /mcps, or remove "disabled": true from mcp.servers.granola in your OpenCode config. |
| `TOOL_UNAVAILABLE` | Granola does not offer *tool* for this account. | Your Granola plan may not include it; run /granola-status to see the tools Granola offers you. |
| `HOST_UNTESTED` | The Granola plugin supports OpenCode >=2.2.3 <2.3.0, found *version*. | Use OpenCode >=2.2.3 <2.3.0, or set the plugin option allowUntestedHost to true to run anyway. |
| `OPTIONS_INVALID` | Plugin option *key* *problem*. | Fix the Granola plugin options in your OpenCode config, then reload OpenCode. |
| `STATUS_UNAVAILABLE` | Granola status could not be read. | Run /granola-status again in a few seconds. The status RPC answers with its error `unavailable`, and the `/granola` dialog says to press r in a few seconds. |
| `SKILLS_INVALID` | The bundled skill *path* needs front matter with a name that matches its folder and a description. | Reinstall the plugin. |
| `PACKAGE_INVALID` | The Granola plugin's package.json *problem*. | Reinstall the plugin. |

Scripts that use the tools RPC get their own error codes; see [Scripting](scripting.md#errors).

When a Granola tool fails because the server is not available, the plugin replaces OpenCode's message with the
matching connection error. The reason in `CONNECTION_FAILED` is shortened to one line, with web addresses
replaced by `<url>`. OpenCode's sign-in error is never repeated, because it can contain a sign-in link.

### Export

| Code | Message | Next step |
| --- | --- | --- |
| `EXPORT_INVALID_INPUT` | The export request *problem*. | For a missing or wrong `meeting_ids` or `content`: Pass meeting_ids (1 to 20 meeting IDs) and content (notes, transcript or both). For an unknown field: Pass only meeting_ids, content, path and overwrite. For `path`: Pass path as a relative path of at most 512 characters, or leave it out. For `overwrite`: Pass overwrite as true or false, or leave it out. |
| `EXPORT_INVALID_PATH` | The export path *path* *problem*. | Use a path inside the export folder, such as `meetings/weekly-sync.md`, without `..`, a leading `/` or links. |
| `EXPORT_EXISTS` | *path* already exists in the export folder. | Choose another path, or ask the user before you export again with overwrite: true. |
| `EXPORT_TOO_LARGE` | The export is larger than its 8 MB limit. | Export fewer meetings at a time. |
| `EXPORT_READ_FAILED` | Granola could not return the *notes or transcript* of meeting *id*: *reason*. Nothing was written. | Export again without that meeting. |
| `EXPORT_WRITE_FAILED` | Could not write *path* in the export folder: *reason*. | Make sure the export folder that /granola-status shows is writable and has free space, then export again. |
| `EXPORT_PATH_NOT_PERMITTED` | OpenCode asks for the external_directory permission before anything outside the project is written, and the export folder *folder* is outside it. | Allow it with { "action": "external_directory", "resource": "*folder*/*", "effect": "allow" } in your permissions, or set exportDirectory inside the project. |

The export's next steps are written for the model, which passes them on to you.

### Events list

| Code | Message | Next step |
| --- | --- | --- |
| `EVENTS_INVALID_INPUT` | The events_list input is invalid: *problems*. | Pass only since, cursor, limit (1 to 500), account and source, as the tool's schema describes. |
| `EVENTS_CURSOR_INVALID` | The cursor was not issued by Granola's events_list for this account and its signed-in user. | Pass a cursor from a previous result of the same account, or start again with since. |
| `EVENTS_ACCOUNT_UNKNOWN` | Granola has one account, default. | Leave account out, or pass "default". |
| `EVENTS_SOURCE_UNKNOWN` | This plugin lists one source, granola. | Leave source out, or pass "granola". |
| `EVENTS_OWNER_UNKNOWN` | Granola did not name the signed-in account's email. | Run /granola-status, and sign in to Granola again if it shows a problem. |
| `EVENTS_READ_FAILED` | Granola's *tool* failed: *reason*. | Call events_list again with the same cursor; if it keeps failing, run /granola-status. |

Through the tools RPC, a script gets the same code and next step as the RPC error `failed`.
