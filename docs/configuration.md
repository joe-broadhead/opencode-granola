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
| `allowUntestedHost` | `false` | `true` lets the plugin run on an OpenCode version outside the tested line (`>=2.2.3 <2.3.0`). Status then shows a warning. |

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
  { "action": "granola_search_transcripts", "resource": "*", "effect": "allow" }
]
```

So:

- Granola's known reads run without a prompt.
- Everything else under `granola_` asks first: Granola's writes (`create_folder`, `update_folder`,
  `add_note_to_folder`, `remove_note_from_folder`, `update_private_notes`, `generate_summary` and `give_feedback`), any Granola tool that this
  plugin version does not know yet, and `export_markdown`.
- Agents without the base rule, such as Explore, are left unchanged. Plan keeps its own restrictions.

OpenCode applies the last rule that matches. Your top-level `permissions` come after the plugin's block in each agent,
an agent's own `permissions` come after those, and answers you saved with "Always allow" are checked last. So your
rules and saved answers override the defaults. A `deny` that you configure always wins, even over a saved answer.

These rules are the whole permission mechanism; approvals are configured only through OpenCode's own rules.

### Agents that miss the default rules

OpenCode creates agents that are defined only in your own config after plugins have started, so they do not get the
block. In those agents, Granola's writes would run without asking. `/granola-status` and the
status dialog list each such agent under "Agents without default rules" and give the fix:

> Put the Granola block first in that agent's own permissions (agents.<agent>.permissions), followed by your
> top-level rules for granola_ actions.

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
    { "action": "granola_generate_summary", "resource": "*", "effect": "deny" },
    { "action": "granola_give_feedback", "resource": "*", "effect": "deny" }
  ]
}
```

Refuse one tool:

```json
{
  "permissions": [
    { "action": "granola_give_feedback", "resource": "*", "effect": "deny" }
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

## Errors

Every error has a code, a message and a next step, in the form `CODE: message Next step: next step`.

### Connection and setup

| Code | Message | Next step |
| --- | --- | --- |
| `NOT_REGISTERED` | The Granola connection isn't registered yet. | Retry in a few seconds; if it persists, check that plugins in your OpenCode config lists the Granola plugin and that no mcp.servers.granola entry points elsewhere. |
| `CONNECTING` | Granola is still connecting. | Retry in a few seconds. |
| `AUTH_REQUIRED` | Granola needs you to sign in. | Run /connect and choose Granola, or run opencode mcp auth granola in a terminal. |
| `CONNECTION_FAILED` | Granola connection failed: *reason*. | Reconnect Granola from /mcps, and if it keeps failing, run /connect and choose Granola to sign in again. |
| `DISABLED` | Granola is disabled in your OpenCode config. | Remove disabled: true from mcp.servers.granola in your OpenCode config. |
| `TOOL_UNAVAILABLE` | Granola does not offer *tool* for this account. | Your Granola plan may not include it; run /granola-status to see the tools Granola offers you. |
| `HOST_UNTESTED` | The Granola plugin is tested with OpenCode >=2.2.3 <2.3.0, found *version*. | Use a tested OpenCode version, or set the plugin option allowUntestedHost to true to run anyway. |
| `OPTIONS_INVALID` | Plugin option *key* *problem*. | Fix the Granola plugin options in your OpenCode config, then reload OpenCode. |
| `STATUS_UNAVAILABLE` | Granola status could not be read. | Run /granola-status again in a few seconds. |
| `SKILLS_INVALID` | The bundled skill *path* needs front matter with a name that matches its folder and a description. | Reinstall the plugin. |
| `PACKAGE_INVALID` | The Granola plugin's package.json *problem*. | Reinstall the plugin. |

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
