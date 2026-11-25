# Capabilities

Every method, source, action and bus event the manifest declares.

<!-- generated:capabilities -->
### Methods

| Method | Class | Accounts | Operations |
|---|---|---|---|
| `status` | read | none | — |
| `probe` | read | optional | `get_account_info` |
| `events_list` | read | optional | `get_account_info`, `search_meetings`, `get_meetings` |
| `export_markdown` | export | optional | `get_meetings`, `get_meeting_transcript` |
| `mcp:add_note_to_folder` | share | none | `add_note_to_folder` |
| `mcp:create_folder` | write | none | `create_folder` |
| `mcp:create_meeting_note_from_transcript` | write | none | `create_meeting_note_from_transcript` |
| `mcp:generate_summary` | write | none | `generate_summary` |
| `mcp:get_account_info` | read | none | `get_account_info` |
| `mcp:get_agent_brief` | read | none | `get_agent_brief` |
| `mcp:get_meeting_attachment` | read | none | `get_meeting_attachment` |
| `mcp:get_meeting_transcript` | read | none | `get_meeting_transcript` |
| `mcp:get_meetings` | read | none | `get_meetings` |
| `mcp:give_feedback` | send | none | `give_feedback` |
| `mcp:list_meeting_folders` | read | none | `list_meeting_folders` |
| `mcp:list_templates` | read | none | `list_templates` |
| `mcp:query_granola_meetings` | read | none | `query_granola_meetings` |
| `mcp:remove_note_from_folder` | delete | none | `remove_note_from_folder` |
| `mcp:search_meetings` | read | none | `search_meetings` |
| `mcp:search_transcripts` | read | none | `search_transcripts` |
| `mcp:update_folder` | write | none | `update_folder` |
| `mcp:update_meeting_title` | write | none | `update_meeting_title` |
| `mcp:update_private_notes` | write | none | `update_private_notes` |
| `mcp:update_summary` | write | none | `update_summary` |

### Sources

| Source | Kind | Reads or output | Method | Cost |
|---|---|---|---|---|
| `granola.meetings` | events | `meeting` | `events_list` | free |
| `granola.meetings.list` | snapshot | `list` | `events_list` | free |

### Actions

None.

### Bus events

None.
<!-- /generated:capabilities -->

## Notes

- **`status`** reads no account. It reports the plugin's version, the OpenCode host, one entry per alias with its live
  MCP connection state and the owner once a probe has answered, the agents whose rules no longer carry the generated
  effects, and a redacted next step. No content and no credential.
- **`probe`** reads `get_account_info` once for an account and answers the owner (the Granola address under `mailto:`)
  and the note-access scopes. It reads no meeting.
- **`events_list`** reads the `granola.meetings` source for one account: meetings as normalised events, oldest first,
  with the title, start, note link, attendees and Granola's summary. A cursor is bound to the plugin, source, account
  and scope; another account's cursor is `CURSOR_INVALID`. It carries the last meeting's start and id, so a page
  boundary inside one timestamp neither skips nor repeats an event. With `list: "meetings"` it answers the
  `granola.meetings.list` snapshot instead: up to 50 recent meeting titles, newest first, `editable: false`.
- **`export_markdown`** writes one local Markdown file for 1 to 20 meetings: notes, transcripts or both. It is class
  `export`, so it asks under `ask-changes` and is off under `read-only`. There is no plan/commit pair: the output is a
  local file, `overwrite` defaults to false, and the access rule is the confirmation.
- **The MCP tools** are declared individually, not as `mcp:*`, because their classes differ: `add_note_to_folder` shares
  a note with everyone who can see the folder, `remove_note_from_folder` deletes, `give_feedback` sends to Granola's
  team, and the rest read or write. Their account is the server an agent calls (`granola`, `granola-work`), so the
  methods take no `account`. `get_meeting_transcript` and `search_transcripts` carry `effect: "ask"`: both return
  verbatim speech by other people, so they ask first at every access level.
- **`sign_out`** is served by Granola but is not declared: the plugin does not expose it, and sign-out stays
  `opencode mcp logout granola` (or `granola-<alias>`). Declaring it would promise a method the plugin does not
  register.
- **The sources** are `granola.meetings` (an events feed of `meeting` items, private, free, 64 KB per answer, note URLs
  on `notes.granola.ai`) and `granola.meetings.list` (a `list` snapshot, private, free, 64 KB). They share the service
  `granola.meetings`, so a person turns one service on or off.
- **No actions and no bus events.** Under standard §4.7 the plugin makes no write a nudge could honestly announce:
  its own write is `export_markdown`, a local file, and the pass-through writes are executed by Granola's MCP server,
  not by the plugin. An app reads through `events_list`; it receives no `changed` nudge from this plugin.
