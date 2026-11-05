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

The options are checked strictly when the plugin starts. An unknown key or a wrong type stops the plugin with one error
that names the key, for example:

```text
OPTIONS_INVALID: Plugin option exportDir is not supported; use exportDirectory or allowUntestedHost. Next step: Fix the Granola plugin options in your OpenCode config, then reload OpenCode.
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

When it starts, the plugin inserts this block into every agent that has the base "allow everything" rule, directly
after that rule:

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
  { "action": "granola_give_feedback", "resource": "*", "effect": "deny" }
]
```

So:

- Granola's known reads run without a prompt.
- `give_feedback`, which sends a report to Granola, is off: a deny on `*` hides it from the model. Granola's own
  instructions tell the model to send it on its own, which would put an unexplained prompt in front of you. To send
  reports, add `{ "action": "granola_give_feedback", "resource": "*", "effect": "ask" }` to your `permissions`.
- Everything else under `granola_` asks first: Granola's writes (`create_folder`, `update_folder`,
  `add_note_to_folder`, `remove_note_from_folder`, `update_private_notes` and `generate_summary`), any Granola tool
  that this plugin version does not know yet, and `export_markdown`.
- Explore and Title also get the block, but their own later deny rules still keep Granola's tools out. Plan keeps its
  own restrictions. An agent without the base rule gets no rules.

OpenCode applies the last rule that matches. Your top-level `permissions` come after the plugin's block in each agent,
an agent's own `permissions` come after those, and answers you saved with "Always allow" are checked last. So your
rules and saved answers override the defaults. A `deny` that you configure always wins, even over a saved answer.

These rules are the whole permission mechanism; approvals are configured only through OpenCode's own rules.

### Agents that miss the default rules

OpenCode creates agents that are defined only in your own config after plugins have started, so they do not get the
block. In those agents, Granola's writes would run without asking. `/granola-status` and the
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
        // Then your top-level rules for Granola tools, so they keep winning:
        { "action": "granola_create_folder", "resource": "*", "effect": "allow" }
        // Then the agent's other rules.
      ]
    }
  }
}
```

`/granola-status` prints the same block as JSON, ready to copy. Do not put the block in the top-level `permissions`:
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

The export asks before it reads any meeting. The prompt shows the path inside the export folder. If you reject it,
nothing is read and nothing is written. If a meeting cannot be read, nothing is written.

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

## Host check

When it loads, the plugin compares the OpenCode version with its supported range, `>=2.2.3 <2.3.0`, which
`package.json` declares as `opencode.host`. Every check runs on OpenCode 2.2.3, 2.2.4 and 2.2.5, the tested releases.

- **A tested release:** the plugin sets everything up. The `OpenCode` row reads, for example,
  `2.2.5 (tested; supported range >=2.2.3 <2.3.0), plugin <version>`.
- **Another release inside the range, such as 2.2.6:** the plugin sets everything up too. The `OpenCode` row calls the
  version `untested` (the RPC's `host.tested` is `false`); the state and the next step are the same as on a tested
  release.
- **Outside the range, including prereleases and development builds:** the plugin does not start, with
  `HOST_UNTESTED`.
- **Outside the range with `"allowUntestedHost": true`:** the plugin sets everything up, and the `OpenCode` row says
  `host untested`. When nothing else is needed, the next step reads
  `If Granola misbehaves, use OpenCode 2.2.3, 2.2.4 or 2.2.5.`

The plugin has no status-only mode: outside the range it does not start at all, so its status never has the state
`host_untested`.

## Status and RPC

`/granola-status`, the TUI `/granola` dialog and the RPC method `status` (RPC ID `granola.meetings`) share one status
model. It reads only OpenCode's local state and holds no token and no sign-in link. `version`, `host`, `state`,
`unguardedAgents` and `nextStep` are the fields every plugin of this family shares, with the same names and meanings:

| Field | Content |
| --- | --- |
| `version` | The plugin's version |
| `host` | `version` (`null` if OpenCode reports none), `range` (the supported range) and `tested` (true only for 2.2.3, 2.2.4 and 2.2.5) |
| `state` | `connected`, `sign_in_required`, `connecting`, `disabled`, `failed`, `not_configured` or `conflict`. The text surfaces show the same states as `connected`, `sign-in required`, `connecting`, `disabled`, `failed`, `not configured` and `conflict`. |
| `title` | Granola's display title, when connected |
| `problem` | `code` and `message`, whenever Granola is not connected and there is no conflict |
| `conflict` | With the state `conflict`: why the user's own `granola` server is not this plugin's |
| `tools` | `visible`: Granola's tools the model can call now, unknown ones included (not the plugin's export); `hidden`: tools the plugin removed, such as `sign_out`; `unknown`: tools this plugin version does not know; `unknownNames`: at most 20 of their names, only those made of lowercase letters, digits and `_` |
| `workspace` | The active workspace from the most recent account read in this OpenCode run |
| `unguardedAgents` | Agents that would run an unknown Granola tool without asking; empty when there are none |
| `permissionsBlock` | With `unguardedAgents`: the rules to put first in each of those agents' own `permissions` |
| `shadowedSkills` | Skills OpenCode loads instead of the plugin's own because they use the same id, each with `name` (the plugin's skill) and `path` (the file that takes its place); empty when there are none |
| `exportDirectory` | The export folder |
| `hostWarning` | Only on a host outside the supported range that runs because of `allowUntestedHost` |
| `nextStep` | Exactly one next step: the `Next step` row, `Nothing to do.` when nothing is needed |

The text surfaces show the rows `Connection`, `Account`, `Access`, `Export folder`, `Skills`, `Tools`,
`Agents without default rules`, `OpenCode` and `Next step`, in that order, every row always there. `Skills` reads
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
| `EXPORT_INVALID_INPUT` | The export request *problem*. | Pass meeting_ids (1 to 20 meeting IDs) and content (notes, transcript or both). |
| `EXPORT_INVALID_PATH` | The export path *path* *problem*. | Use a path inside the export folder, such as `meetings/weekly-sync.md`, without `..`, a leading `/` or links. |
| `EXPORT_EXISTS` | *path* already exists in the export folder. | Choose another path, or ask the user before you export again with overwrite: true. |
| `EXPORT_TOO_LARGE` | The export is larger than its 8 MB limit. | Export fewer meetings at a time. |
| `EXPORT_READ_FAILED` | Granola could not return the *notes or transcript* of meeting *id*: *reason*. Nothing was written. | Export again without that meeting. |
| `EXPORT_WRITE_FAILED` | Could not write *path* in the export folder: *reason*. | Make sure the export folder that /granola-status shows is writable and has free space, then export again. |

The export's next steps are written for the model, which passes them on to you.
