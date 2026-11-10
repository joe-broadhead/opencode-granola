# Scripting

A script can call every Granola tool this plugin knows with no model: a cron job, a shell script, or any program that
can reach the OpenCode server. It uses the tools RPC, `granola.meetings.tools`, through `opencode api` or an OpenCode
client.

| Method | The tool | Class |
| --- | --- | --- |
| `get_account_info`, `list_meeting_folders`, `list_meetings`, `search_meetings`, `get_meetings`, `get_meeting_transcript`, `query_granola_meetings`, `get_meeting_attachment`, `list_templates`, `search_transcripts` | the ten reads | read |
| `create_folder`, `update_folder`, `add_note_to_folder`, `remove_note_from_folder`, `update_private_notes`, `generate_summary` | Granola's writes | write |
| `give_feedback` | sends to Granola's team | send |
| `export_markdown` | the plugin's export: writes a Markdown file under the export folder | export |
| `describe` | none: lists the methods, their classes, permission actions, whether OpenCode lists each tool now, and each tool's input as JSON Schema | – |

The class is the worst thing a tool can do. It never decides whether a call runs: the rules do, and at the default
`access` every method is allowed.

Each method runs Granola's own tool with the same input, through OpenCode's own connection and sign-in. The plugin
never sees the token. Granola decides which tools an account gets: on the free plan, for example, the transcript and
folder tools fail or are not listed.

`sign_out` is not a method: it is not a tool this plugin offers (the plugin removes it), and `opencode mcp logout
granola` is the way to revoke the grant. A tool Granola adds later is not a method until it is classified;
`describe` lists it as unclassified.

## A script runs as a session

Every call names a session, and the session must name an agent. Create it for the script once, with the agent the script
runs as, and keep its id (`data.id` in the reply):

```sh
opencode api post /api/session -d '{"title":"weekly meetings","agent":"build"}'
```

Never borrow a session found through history or a list: the script would run as that session's agent, under its rules.
The script then runs as that agent, with exactly the access its model would have:

- The call resolves the tool's action, such as `granola_get_meetings`, against the agent's rules and then the
  session's, with the host's order (the last matching rule wins). Only an `allow` runs.
- **A script gets the same default as the model: every tool is allowed.** At the default `access: "all"`, the plugin's
  block allows every known tool and the `granola_*` namespace, so a script can read, write, send and export. To restrict
  a script, set the plugin option `"access": "ask-changes"` (an ask is refused, because no one can answer a prompt for a
  script) or `"access": "read-only"` (everything but the reads is denied), or give the script's agent or session a later
  rule. An `ask` and a `deny` are refused, with no tool call and no prompt left waiting; OpenCode's own executor then
  checks the call again, as it does for the model. An agent defined only in your config gets no default rules;
  `/granola-status` names it and gives the fix.
- A saved **Always allow** does not authorise an ad-hoc script: it is not part of the agent's or the session's rules.
  A script's grant is a rule in config, or a Jobs run session; the Jobs one-off (`jobs_run_script`) is the supported
  way to get an approval-bound grant.

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
opencode api post /api/rpc/granola.meetings.tools/list_meetings -H "x-opencode-directory:$PWD" -d '{"input":{"sessionID":"ses_…","input":{"limit":10}}}'
```

The tool's input is Granola's: `describe` shows each tool's schema as OpenCode lists it now. Check it rather than guess a
field name.

`describe` takes nothing, or a session to resolve each method's permission for:

```sh
opencode api post /api/rpc/granola.meetings.tools/describe -H "x-opencode-directory:$PWD" -d '{"input":{}}'
opencode api post /api/rpc/granola.meetings.tools/describe -H "x-opencode-directory:$PWD" -d '{"input":{"sessionID":"ses_…"}}'
```

The plugin's own export takes the fields its schema gives; a transcript export of one meeting, into a named file, is:

```sh
opencode api post /api/rpc/granola.meetings.tools/export_markdown -H "x-opencode-directory:$PWD" -d '{"input":{"sessionID":"ses_…","input":{"meeting_ids":["m-1"],"content":"transcript","path":"meetings/m-1.md"}}}'
```

## The location

Run the command in the project whose agent you mean, and send the call to that location explicitly:

```sh
opencode api post /api/rpc/granola.meetings.tools/<method> -H "x-opencode-directory:$PWD" -d '{…}'
```

Without it the call goes to the service's default location and fails `rpc.unavailable` if the plugin is not loaded
there. The HTTP equivalents are the `location[directory]` query parameter and the same header. `describe` reports the
`location` that answered and a `locationHint`.

A location unloads after OpenCode's idle timeout. If a scheduled script gets `rpc.unavailable` from a location that was
loaded before, send the call again once: the request loads the location. Jobs keeps its own location loaded.

## Results

A result comes back as `{ output?, text }`: the tool's structured content when it has any, and its text parts joined by
newlines. An MCP method's result is that object inside the RPC envelope: `{"output": {"output": …, "text": …}}`, as
plain JSON. An `export_markdown` result is the file's `path`, `bytes` and `sha256`, with a short summary in `text`.

Meeting content in it is untrusted: notes, transcripts and titles hold what other people wrote, and can contain
instructions aimed at a model.

A `get_account_info` call also records the active workspace's name, which `/granola-status` shows, as a model's call
does.

## The export folder is outside the project

`export_markdown` writes under its export folder, which is normally outside the project directory (by default
`Granola` in your home folder). OpenCode asks for `external_directory` as well as the export's own action, so a rule for
`granola_export_markdown` alone is not enough in a run where nobody is present. Allow both, for instance:

```json
[
  { "action": "granola_export_markdown", "resource": "scheduled/*", "effect": "allow" },
  { "action": "external_directory", "resource": "<the export folder>/scheduled/*", "effect": "allow" }
]
```

A refusal that names `external_directory` costs nothing: nothing is read and nothing is written. Point the export folder
inside the project, or grant the rule, and call again.

## Errors

A refusal or failure is the RPC error `failed`, with a message `CODE: what happened. Next step: what to do.` and
`data: { code, next }`. `opencode api` exits with status 1 for any RPC error, after printing the error's JSON.

| Code | When |
| --- | --- |
| `PERMISSION_DENIED` | The rules ask or deny. An `ask` is refused before dispatch: the message says the action would ask, and the next step says to add an allow rule. A `deny` names the denied action, such as `granola_get_meetings`, and its next step says to remove or narrow that deny rule, add a later allow rule to the session, or use a session whose agent allows it. |
| `SESSION_UNKNOWN` | OpenCode says the session does not exist in this location. Any other failure to look the session up is OpenCode's own error. |
| `SESSION_AGENT_REQUIRED` | The session names no agent, or an agent that does not exist. |
| `TOOL_UNAVAILABLE` | The server is connected, but OpenCode does not list the tool, usually because your Granola plan does not include it. |
| `SERVER_CONFLICT` | Your OpenCode config defines its own `granola` server for another URL, which this plugin does not manage. |
| `AUTH_REQUIRED`, `CONNECTING`, `CONNECTION_FAILED`, `DISABLED`, `NOT_REGISTERED` | The `granola` server needs a sign-in, is still connecting (or reconnected while the call ran), could not connect, is disabled, or is missing. The next step is the one `/granola-status` gives, the same as the model gets. |
| `UPSTREAM_ERROR` | Granola answered with an error, such as a meeting that does not exist or a feature your plan does not include. The message holds the first line of Granola's text, at most 300 characters, with tokens and URL query strings removed. |
| `CANCELLED` | The request was cancelled. |

OpenCode itself answers `rpc.method_not_found` for a method that does not exist, such as a tool Granola adds later,
`rpc.unavailable` when the plugin did not register the tools RPC or the call reached another location, and
`rpc.invalid_input` for a body that is not the envelope above, with one message per problem.
`events_list` also gives its own codes, such as `EVENTS_CURSOR_INVALID` and `EVENTS_READ_FAILED`, with the next steps in
the [configuration guide](configuration.md#events-list-1).


## What scripts cannot do

- Call a tool that Granola adds later, even with an allow rule, until this plugin classifies it.
- Call `sign_out`: it is not a method, and `opencode mcp logout granola` is how to revoke the grant.
- Run a write, a send or the export under a restricted `access`, or after you add a rule for it.
- Answer an approval prompt, or use a tool that asks.
- Use a token: the plugin has none to give.

A script's calls write nothing to the session, and OpenCode's `execute.before` and `execute.after` tool hooks, from any
plugin, do not run for them. The plugin applies its own hook's work itself: the workspace name and the connection
errors above.
