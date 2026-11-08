# Scripting

A script can read Granola with no model: a cron job, a shell script, or any program that can reach the OpenCode
server. It uses the tools RPC, `granola.meetings.tools`, through `opencode api` or an OpenCode client.

| Method | The tool |
| --- | --- |
| `get_account_info` | `granola_get_account_info` |
| `list_meeting_folders` | `granola_list_meeting_folders` |
| `list_meetings` | `granola_list_meetings` |
| `search_meetings` | `granola_search_meetings` |
| `get_meetings` | `granola_get_meetings` |
| `get_meeting_transcript` | `granola_get_meeting_transcript` |
| `query_granola_meetings` | `granola_query_granola_meetings` |
| `get_meeting_attachment` | `granola_get_meeting_attachment` |
| `list_templates` | `granola_list_templates` |
| `search_transcripts` | `granola_search_transcripts` |
| `events_list` | `granola_events_list`, the plugin's own read: the meetings you took part in since a cursor, as Memory's events ([configuration](configuration.md#events-list)) |
| `describe` | none: lists the methods, their permission actions, whether OpenCode lists each tool now, and each tool's input as JSON Schema |

Each method runs Granola's own read tool with the same input, through OpenCode's own connection and sign-in. The
plugin never sees the token. Granola decides which tools an account gets: on the free plan, for example, the
transcript and folder tools fail or are not listed.

These are never methods, even with an allow rule:

- Granola's writes and sends: `create_folder`, `update_folder`, `add_note_to_folder`, `remove_note_from_folder`,
  `update_private_notes`, `generate_summary` and `give_feedback`;
- `sign_out`;
- the plugin's own `export_markdown`, which writes a local file;
- any tool that Granola adds later.

## A script runs as a session

Every call names a session, and the session must name an agent. The script runs as that agent, with exactly the access
its model would have:

- A tool that the agent's rules or the session's rules hide from the model is refused. OpenCode hides a tool when the
  last rule that matches its permission name, such as `granola_get_meetings`, on resource `*` is a `deny`.
- OpenCode then checks the call itself, as it does for the model: the agent's rules, the session's rules, then saved
  approvals.
- No one answers a prompt for a script, so an `ask` is refused with `PERMISSION_DENIED` at once, and no prompt is left
  waiting. The plugin's default rules allow the ten reads, so an agent with the default rules needs nothing more. An
  agent defined only in your config misses the default rules; `/granola-status` names it and gives the fix.

Create the session once, with the agent the script runs as, and keep its id:

```sh
opencode api post /api/session -d '{"title":"weekly meetings","agent":"build"}'
```

Session rules come after the agent's, so a session can narrow what its script may do. This one can list and read
meetings, but not read transcripts or ask questions across meetings:

```sh
opencode api post /api/session -d '{"title":"weekly meetings","agent":"build","permissions":[
  {"action":"granola_*","resource":"*","effect":"deny"},
  {"action":"granola_list_meetings","resource":"*","effect":"allow"},
  {"action":"granola_get_meetings","resource":"*","effect":"allow"}
]}'
```

## Calling a method

The body is `{"input": {"sessionID": "<session>", "input": <the tool's input>}}`. Both keys are required, and no other
key is allowed:

```sh
opencode api post /api/rpc/granola.meetings.tools/list_meetings -d '{"input":{
  "sessionID":"ses_…",
  "input":{"limit":10}
}}'
```

The tool's input is Granola's: `describe` shows each tool's schema as OpenCode lists it now.

```sh
opencode api post /api/rpc/granola.meetings.tools/describe -d '{"input":{}}'
```

A result is `{"output": {"output": <the tool's structured content, or its text when it has none>, "text": <the
tool's text>}}`, as plain JSON. Meeting content in it is untrusted: notes, transcripts and titles hold what other
people wrote, and can contain instructions aimed at a model.

A `get_account_info` call also records the active workspace's name, which `/granola-status` shows, as a model's call
does.

`opencode api` calls run in the OpenCode service's default location, your home directory, whatever directory you run
them from, and use that location's `granola` connection. To target a project, call the HTTP API with
`?location[directory]=<dir>`, or create the session with `"location":{"directory":"<dir>"}`. The session may belong to
another directory.

## Errors

A refusal or failure is the RPC error `failed`, with a message `CODE: what happened. Next step: what to do.` and
`data: { code, next }`. `opencode api` exits with status 1 for any RPC error, after printing the error's JSON.

| Code | When |
| --- | --- |
| `SESSION_UNKNOWN` | OpenCode says the session does not exist. Any other failure to look the session up is OpenCode's own error. |
| `SESSION_AGENT_REQUIRED` | The session names no agent, or an agent that does not exist. |
| `PERMISSION_DENIED` | The agent's or the session's rules ask for an approval, or deny the tool. A deny names the action it refused and says to remove or narrow that rule, or to use a session whose agent allows it. |
| `SERVER_CONFLICT` | Your OpenCode config defines its own `granola` server for another URL, which this plugin does not manage. |
| `AUTH_REQUIRED`, `CONNECTING`, `CONNECTION_FAILED`, `DISABLED`, `NOT_REGISTERED` | The `granola` server needs a sign-in, is still connecting (or reconnected while the call ran), could not connect, is disabled, or is missing. The next step is the one `/granola-status` gives, the same as the model gets. |
| `TOOL_UNAVAILABLE` | The server is connected, but OpenCode does not list the tool, usually because your Granola plan does not include it. |
| `UPSTREAM_ERROR` | Granola answered with an error, such as a meeting that does not exist or a feature your plan does not include. The message holds the first line of Granola's text, at most 300 characters, with tokens and URL query strings removed. |
| `CANCELLED` | The request was cancelled. |

`events_list` also gives its own codes, such as `EVENTS_CURSOR_INVALID` and `EVENTS_READ_FAILED`, with the next steps in
the [configuration guide](configuration.md#events-list-1).

OpenCode itself answers `rpc.invalid_input` for a body that is not the envelope above, and `rpc.method_not_found` for a
method that does not exist, such as a write or a tool Granola added later.

## What scripts cannot do

- Call a tool that is not one of the ten reads, even with an allow rule: no write, send, sign-out or export.
- Answer an approval prompt, or use a tool that asks.
- Use a token: the plugin has none to give.

A script's calls write nothing to the session, and OpenCode's `execute.before` and `execute.after` tool hooks, from any
plugin, do not run for them. The plugin applies its own hook's work itself: the workspace name and the connection
errors above.
