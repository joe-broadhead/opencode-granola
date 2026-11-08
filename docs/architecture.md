# Architecture

The plugin is a thin layer over OpenCode's own MCP support. OpenCode connects to Granola's official MCP server, runs
the sign-in, stores the credentials, runs Granola's tools and asks for permission. The plugin registers the server,
sets the default permission rules, and adds a status model, a Markdown export, a status command, two skills and a
terminal UI dialog. It uses only the public `@opencode/plugin` API of OpenCode 2.2.3.

```text
OpenCode 2.2.x
├─ MCP server "granola"   registered by the plugin; OpenCode owns transport, OAuth and credentials
│    Granola's tools  →  granola_<tool>, tools.granola.<tool> in Code Mode
├─ plugin "granola.meetings"   (dist/index.js, one bundle)
│    setup            validate options; refuse an untested OpenCode version
│    mcp.transform    register "granola" → https://mcp.granola.ai/mcp, unless the user configured another server
│    integration      name the server's integration "Granola"; mark a rejected sign-in as needing a new one
│    agent.transform  after each agent's base "* * allow": granola_* ask, then the known reads allow
│    tool.transform   namespace description; hide sign_out; add export_markdown
│    execute.after    rewrite "server not available" failures; remember the active workspace name
│    commands         /granola-status
│    skills           granola, granola-meeting-brief
│    rpc              granola.meetings/status
│    tools RPC        granola.meetings.tools: describe and every known tool, for scripts
└─ TUI part "granola.meetings.tui"   (dist/tui.js, one bundle)
     status dialog: palette entry "Granola: Status", slash /granola
```

## Source map

| Path | Role |
| --- | --- |
| `src/index.ts` | `Plugin.define` with the id `granola.meetings`; binds the tools RPC to OpenCode's full context. |
| `src/setup.ts` | Wires the parts below in order. Its `SetupContext` names exactly the parts of OpenCode's context that the plugin uses, apart from the tools RPC's. |
| `src/meta.ts` | Reads the version and the supported OpenCode range (`opencode.host`) from `package.json`. |
| `src/hosts.ts` | `TESTED_HOSTS`, the one list of tested OpenCode releases, which status and the host and pack tests read. |
| `src/options.ts` | Strict option parsing: `exportDirectory` and `allowUntestedHost`. |
| `src/host-check.ts` | Compares `ctx.app.version` with the supported range; refuses with `HOST_UNTESTED` unless `allowUntestedHost` is set, and marks a release outside `TESTED_HOSTS` untested. |
| `src/server.ts` | Registers the official server under `granola`, or records a conflict with the user's own entry. |
| `src/known-tools.ts` | The known-tool table: reads, writes, the hidden `sign_out`, and the plugin's own tools. |
| `src/permissions.ts` | The default rule block, its insertion, and the check for agents that missed it. |
| `src/integration.ts` | Names the server's sign-in "Granola" in `/connect`, and marks a stored sign-in that Granola rejects so `/connect` shows "Sign in required". |
| `src/tools.ts` | The namespace description, hiding `sign_out`, and the `execute.after` hook, which also names the `external_directory` rule for a refused export. |
| `src/workspace.ts` | Reads the active workspace's display name from a `get_account_info` result. |
| `src/status.ts` | The status model behind `/granola-status`, the RPC and the TUI dialog. |
| `src/errors.ts` | Error codes, messages and next steps, the one `PLUGIN_CODES` table, and `Tool.Error` for the model. |
| `src/commands.ts` | `/granola-status`, posted as a notice that does not start a model turn. |
| `src/skills.ts` | Loads `skills/*/SKILL.md`. |
| `src/export/` | `export_markdown`: input, paths, Granola reads, rendering and its errors. |
| `src/io/markdown-export.ts` | The atomic file writer. |
| `src/rpc/` | The RPC contract, shared by the server and the TUI part, and its registration. It also carries the `access` type, so the TUI part names it without importing option parsing. |
| `src/tui/` | The terminal UI status dialog, bundled into `dist/tui.js`. |
| `src/host/tools-rpc.ts` | The tools RPC for scripts. A copy of a module shared by several plugins; only its marked block is Granola's. |

## Permissions

OpenCode asserts the action `granola_<tool>` with the resource `*` before each Granola call. Every agent starts from a
base `* * allow` rule, and OpenCode applies the last matching rule. The plugin's `agent.transform` inserts its block
directly after that base rule, so the user's top-level rules, the agent's own rules and saved "Always allow" answers,
which all come later, override it. The block comes from `defaultRules(access)`: every tool is allowed at `"all"`, the
reads only with everything else asking at `"ask-changes"`, and the reads only with everything else denied at
`"read-only"`. Agents without the base rule are left alone, so a stricter agent is never
weakened. The transform is synchronous and idempotent: OpenCode replays it on every rebuild, and the block appears
once.

Agents defined only in the user's config are created after plugins run and miss the block. The status model finds
them, by checking which agents have a base allow, lack the block, and would let a Granola tool this plugin does not
know run without asking, and gives the per-agent fix.

The default rules are the whole permission mechanism. Plugin tools are not prompted by OpenCode, so
`export_markdown` calls `ctx.permission.assert` itself, with its file path as the resource.

## Known and unknown tools

`src/known-tools.ts` classifies Granola's tools from the read-only and destructive hints Granola publishes. The
classification only decides the default rules: the reads are always allowed, and everything else follows the `access`
option. A tool Granola adds later is never blocked or hidden, and `granola_*` covers it; status lists it by name.

## Status

One model, built by `buildStatus` in `src/status.ts`, serves `/granola-status`, the RPC method and the TUI dialog. It
reads only OpenCode's local state: `ctx.mcp.list()` for the connection, `ctx.tool.list()` for tool counts,
`ctx.agent.list()` for agents that missed the defaults, and `ctx.skill.list()` for a skill of the user's that uses one
of the plugin's skill ids and so takes its place. It never calls Granola. The RPC carries the fields every plugin of
this family shares (`version`, `host`, `state`, `access`, `unguardedAgents`, `nextStep`), and answers a status it cannot
read with its error `unavailable`. The workspace name comes from the last successful `get_account_info` call, seen by the
`execute.after` hook or the tools RPC, and is kept in memory only.

## Export

`export_markdown` validates its input and path, checks that Granola's read tools are available, and asks for
permission. Its folder is outside the project, so OpenCode asks for `external_directory` as well; a refusal that names
it becomes `EXPORT_PATH_NOT_PERMITTED`, with that rule as its next step. Only then does it read the meetings through the executors of OpenCode's own `granola_get_meetings` and
`granola_get_meeting_transcript` tools, which check their own permissions. It pages transcripts within an 8 MB budget,
renders one Markdown document, and writes it atomically under the export folder with mode `0600`. When Granola
refuses transcripts for the user's plan, or does not list the transcript tool, the export keeps the notes and marks
each transcript as not on the plan. Those executors skip
OpenCode's tool hooks, so the export maps connection failures to the plugin's error codes itself.

## Scripts

The tools RPC, `granola.meetings.tools`, lets a script call every known Granola tool with no model
([Scripting](scripting.md)). Each call names a session; the session's agent and rules decide, exactly as for the
model. The RPC resolves the method's action against the agent's and the session's rules before dispatch, so only an
allow runs (every tool at the default `access`), and then calls the tool's executor from `ctx.tool.list()`, which checks the agent's rules, the session's
rules and saved approvals. A permission `evaluate` hook turns an inner ask on one of the RPC's own calls in flight into
a deny, since no one can answer it. Every known tool is a method, with its class: the list is `src/known-tools.ts`, and
the plugin's export is built in setup, where it has the export folder.

The executor skips `execute.after`, so the RPC does the hook's work itself. An account read records the workspace with
the hook's own function; the RPC tells every running instance of the plugin, which share OpenCode's one Granola
sign-in. A call to a server that is not connected gets the connection codes and next steps of `src/errors.ts`.

## Platform facts

These hold on OpenCode 2.2.3, 2.2.4, 2.2.5 and 2.2.6, the releases in `TESTED_HOSTS`.

| Topic | Fact | Source |
| --- | --- | --- |
| Credential status | A status set with `integration.connection.status` is not on what `connection.active` returns; `integration.get` projects it as `connections[].status`, so the plugin reads its own mark back from there and clears only its own message. A 401 whose token refresh fails with no refresh token leaves the credential in place, so the `/connect` mark is only observable then. The host test signs in through the loopback callback and the token endpoint, then challenges, and asserts the mark is set and cleared. | The host test, on 2.2.3, 2.2.4, 2.2.5 and 2.2.6 |

## Build

`scripts/build.mjs` bundles each part OpenCode loads into one file with esbuild: `src/index.ts` into `dist/index.js`
and `src/tui/index.tsx` into `dist/tui.js`. Shared code, such as the RPC contract and the status rows, is inlined into
both. Neither bundle imports a sibling file, so an in-place update cannot pair a new entry with an older cached module.
Only `@opencode/plugin`, OpenTUI, Solid and `node:*` built-ins stay external, because OpenCode provides them; the
build fails on any other import. `dist/index.js` finds `package.json` and `skills/` one level up.

## Terminal UI

The TUI part is compiled at build time with Babel's Solid transform, because OpenCode does not compile `.tsx` from
`node_modules`. The dialog reads the RPC `status` method
when it opens and when `r` is pressed. It subscribes to connection, agent, integration, credential and end-of-turn
events when it opens and unsubscribes when it closes. The palette
command is registered from the part's setup; the dialog's own keys live in a layer created inside the dialog.
