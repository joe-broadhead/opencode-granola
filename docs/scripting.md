# Scripting

A script can read Granola with no model: a cron job, a shell script, or any program that can reach the OpenCode
server. It uses the tools RPC, `granola.meetings.tools`, through `opencode api` or an OpenCode client.

| Method | The tool | Class |
| --- | --- | --- |
| `get_account_info`, `list_meeting_folders`, `list_meetings`, `search_meetings`, `get_meetings`, `get_meeting_transcript`, `query_granola_meetings`, `get_meeting_attachment`, `list_templates`, `search_transcripts` | the ten reads | read |
| `create_folder`, `update_folder`, `add_note_to_folder`, `remove_note_from_folder`, `update_private_notes`, `generate_summary` | Granola's writes | write |
| `give_feedback` | sends to Granola's team; the default rules deny it | send |
| `export_markdown` | the plugin's export: writes a Markdown file under the export folder | export |
| `describe` | none: lists the methods, their classes, permission actions, whether OpenCode lists each tool now, and each tool's input as JSON Schema | – |

Each method runs Granola's own tool with the same input, through OpenCode's own connection and sign-in. The plugin
never sees the token. Granola decides which tools an account gets: on the free plan, for example, the transcript and
folder tools fail or are not listed.

`sign_out` is not a method: it is not a tool this plugin offers (the plugin removes it), and `opencode mcp logout
granola` is the way to revoke the grant. A tool Granola adds later is not a method until it is classified;
`describe` lists it as unclassified.

## A script runs as a session

Every call names a session, and the session must name an agent. The script runs as that agent, with exactly the access
its model would have:

- The call resolves the tool's action, such as `granola_get_meetings`, against the agent's rules and then the
  session's, with the host's order (the last matching rule wins). Only an `allow` runs.
- An `ask` is refused, because no one is there to answer the prompt, and a `deny` is refused; both cost nothing: no
  tool call and no prompt left waiting. OpenCode's own executor then checks the call again, as it does for the model.
- The plugin's default rules allow the ten reads, and ask for the writes and the export. So a script that writes,
  sends or exports needs a prior allow rule for that action. An agent defined only in your config misses the default
  rules; `/granola-status` names it and gives the fix.
- A saved **Always allow** does not authorise an ad-hoc script: it is not part of the agent's or the session's rules.
  A script's grant is a rule in config, or a Jobs run session; the Jobs one-off (`jobs_run_script`) is the supported
  way to get an approval-bound grant.

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

## The location

Run the command in the project whose agent you mean, and send the call to that location explicitly:

```sh
opencode api post /api/rpc/granola.meetings.tools/get_meetings -H "x-opencode-directory:$PWD" \
  -d '{"input":{"sessionID":"ses_…","input":{"meeting_ids":["m-1"]}}}'
```

Without it the call goes to the service's default location, your home directory, and fails `rpc.unavailable` if the
plugin is not loaded there. The HTTP equivalents are the `location[directory]` query parameter and the same header.
`describe` reports the plugin's `location` and a `locationHint`, and with a session each method's `permission`.

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

OpenCode itself answers `rpc.invalid_input` for a body that is not the envelope above, and `rpc.method_not_found` for a
method that does not exist, such as a write or a tool Granola added later.

## What scripts cannot do

- Call a tool that is not one of the ten reads, even with an allow rule: no write, send, sign-out or export.
- Answer an approval prompt, or use a tool that asks.
- Use a token: the plugin has none to give.

A script's calls write nothing to the session, and OpenCode's `execute.before` and `execute.after` tool hooks, from any
plugin, do not run for them. The plugin applies its own hook's work itself: the workspace name and the connection
errors above.
