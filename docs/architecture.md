# Architecture

## Layers

| Layer | Files | Does |
|---|---|---|
| Entry | `src/index.ts` | `Plugin.define({ id, setup })`, the host gate, the account wiring, the bundled skills and one `register` call |
| Manifest | `src/manifest.ts` | reads `package.json` `capabilities` and checks it with the contract's validator |
| Accounts | `src/accounts.ts` | one Granola MCP server per alias, through the contract's `accounts` module |
| Skills | `src/skills.ts` | reads `skills/*/SKILL.md`, validates each front matter, and registers every skill through `ctx.skill.transform` |
| Handlers | `src/handlers/` | one handler per method: the input, the answer schema, the description and the work |
| Provider | `src/provider/` | the MCP tool executor per alias, Granola's text and JSON shapes, the meeting page and the transcript reader |
| Export | `src/export/` | Markdown rendering, path and link checks, and the atomic local write |

The entry is deliberately thin. `assertHost` refuses an untested OpenCode release. `readSkills` reads the package's
`skills/*/SKILL.md` before any transform runs; the setup call registers them directly through `ctx.skill.transform`, because the
contract's `register` does not register skills. `register` from the contract wires doors 1–3: one agent tool per method
in the `granola` namespace, the same tools in Code Mode, one RPC registration under `granola`, the permission
assertions on `<alias>:<operation>`, and the access rules inserted into every agent. This repository never calls
`ctx.tool`, `ctx.rpc` or `ctx.permission` itself.

## The call path

1. OpenCode loads `dist/index.js` through the package's `./server` export and calls `setup(ctx)`.
2. `assertHost` refuses an OpenCode release outside `>=2.4.1 <2.5.0`, unless `allowUntestedHost` is set.
3. `accountsOf` reads the aliases from the options; `registerAccounts` adds one remote MCP server per alias through
   `ctx.mcp.transform`, named `granola` or `granola-<alias>`. A server it could not add becomes a `status` problem.
4. `readSkills` reads and validates every `skills/*/SKILL.md`; setup registers each one directly through
   `ctx.skill.transform`, so OpenCode lists the plugin's `granola` and `granola-meeting-brief` skills after load.
5. `register` checks the handler table against `capabilities.methods`, generates the access rules into every agent,
   and registers the tools and the single RPC id.
6. A call resolves the account, validates the input against the handler's schema, asserts the method's operations on
   `<alias>:<operation>`, runs the handler, checks the answer and maps a failure to the contract's error table.
7. A handler that needs Granola calls the provider. The provider turns the alias into its server name, finds the
   server's tool (`granola-work_get_meetings`) in OpenCode's own tool registry, and executes it as the same session and
   agent. OpenCode owns the OAuth token; the plugin never sees it.

## The provider

`src/provider/client.ts` is the only file that names the vendor endpoint. It holds the owner and plan each probe
recorded, per alias, and reads the live MCP connection state for `status`. `src/provider/granola.ts` is the only file
that knows Granola's text and JSON shapes; `src/provider/meetings.ts` builds the events page and the list snapshot;
`src/provider/transcript.ts` pages through a transcript for the export.

The plugin keeps no content cache and no credential. The consumer owns the cursor and stores it; the plugin binds the
cursor to the plugin, source, account and scope and refuses one another account presents. `status` reads the host and
the accounts on demand and never calls Granola for content.

`export_markdown` is the plugin's only write. It writes one file under `exportDirectory` with a private staging file
and an atomic hard link (or rename when overwriting), checks every folder for links, and writes nothing when a
provider read fails.

## OpenCode APIs

| API | Who calls it |
|---|---|
| `Plugin.define` | `src/index.ts` |
| `ctx.app.version` | `src/index.ts`, for the host gate and status |
| `ctx.mcp.transform` | `src/accounts.ts` |
| `ctx.skill.transform` | `src/skills.ts` |
| `ctx.agent.transform` | `register`'s access rules |
| `ctx.agent.list` | `register`, for `call.unguardedAgents()` |
| `ctx.tool.list` and the tool's `execute` | `src/provider/client.ts`, to reach Granola's MCP tools |
| `ctx.mcp.list` | `src/provider/client.ts`, for each alias's connection state |
| `ctx.tool.transform`, `ctx.rpc.register`, `ctx.permission.assert` | `register` only |

## Build

`scripts/build.mjs` bundles `src/index.ts` into `dist/index.js` with esbuild, through `npm run bundle`.
`@opencode/*` stays external, because OpenCode provides it; the contract modules are bundled, so an install needs no
build and no runtime dependency. `dist/` is committed so a git install works without a lifecycle script.
