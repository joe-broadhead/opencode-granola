# Repository rules

This repository builds `@joe-broadhead/opencode-granola`, an OpenCode plugin that registers Granola's official MCP
server, `https://mcp.granola.ai/mcp`, under the name `granola`, with default permission rules, a Markdown export,
`/granola-status`, a TUI status dialog and two skills. Read [docs/architecture.md](docs/architecture.md) before you
change code, and [CONTRIBUTING.md](CONTRIBUTING.md) for the checks and releases.

## Rules

- **Public APIs only:** `@opencode/plugin` 2.2.3 in `src`, plus `@opencode/sdk` and `@opencode/client` in tests. The
  supported range is `opencode.host` in `package.json`, exactly `>=2.2.3 <2.3.0`; the host check reads it from there.
  `TESTED_HOSTS` in `src/hosts.ts` is the one list of tested releases (2.2.3, 2.2.4, 2.2.5); status calls only those
  tested, and the host and pack tests run on each.
- **Greenfield.** No migration code, compatibility paths or dead code, exports, dependencies, docs or tests. Delete
  rather than deprecate.
- **No runtime dependencies or peers.** OpenCode packages, OpenTUI and Solid are devDependencies. Ship prebuilt
  JavaScript with no lifecycle scripts and no declaration files.
- **Two self-contained bundles.** `scripts/build.mjs` (esbuild) writes only `dist/index.js` and `dist/tui.js`. Neither
  imports a sibling file; only `@opencode/plugin`, OpenTUI, Solid and `node:*` stay external. `tsc` only typechecks.
- **Nothing always visible.** Status lives in `/granola-status` and the `/granola` dialog.
- **One status model.** `src/status.ts` builds it; the rows are Connection, Account, Access, Export folder, Skills,
  Tools, Agents without default rules (`none` when empty), OpenCode and exactly one Next step. The status RPC carries the
  shared fields `version`, `host`, `state` (machine form, such as `sign_in_required`), `unguardedAgents` and
  `nextStep`, and maps a failed read to its error `unavailable`.
- **Default rules, not hooks.** `ctx.agent.transform` inserts the block from `src/permissions.ts` after each agent's
  base allow and never weakens a stricter agent. Agents that miss it, and whose own rules would let an unknown
  Granola tool run without asking, are named by status, with the block to paste.
- **Granola's tools stay Granola's.** Classify them in `src/known-tools.ts` to match the live server; unknown tools
  ask. `sign_out` stays hidden.
- **Errors** are `CODE: what happened. Next step: one step.` Upstream errors pass through unchanged, except in the
  tools RPC for scripts, which gives Granola's first line only, redacted, as `UPSTREAM_ERROR`.
- **Scripts read only.** The tools RPC, `granola.meetings.tools`, makes exactly the known reads methods; writes,
  `sign_out`, `export_markdown` and unknown tools never are. `src/host/tools-rpc.ts` is a copy of a module shared by
  several plugins: change only its block between the `PLUGIN-SPECIFIC` markers here, and the rest in the shared copy
  first. The executor it calls skips tool hooks, so it applies the hook's work itself.
- **Text** in skills, errors and status is plain language with no process terms (`test/ux.test.ts`). Docs describe
  what the code does now. No tokens, sign-in links, meeting content or personal data anywhere; test data is invented.
- **Releases** come only from the release workflow on a `vX.Y.Z` tag; it refuses a private package or a tag that
  differs from the version.
- **Tests** use narrow fakes typed against `SetupContext` with `satisfies`. Host tests run isolated hosts with
  Granola's URL routed to `test/synthetic-granola/`, each in a git repository under the system's `/tmp` (never under
  `TMPDIR` or `HOME`) and each stock host on its own port. Never call Granola, never point a CLI at your own OpenCode
  service, and never type a prompt into a real TUI or `opencode run`.
- `npm run check` passes before every commit.

## Forbidden

`npm run lint` (`scripts/check-forbidden.mjs`) rejects, in `src`, `test` and `scripts`:

- `ui.slot` in `src`;
- the deprecated `ctx.generate.text` and `experimental.policies`, and the experimental `experimental.artifact`;
- a permission `evaluate` hook, except exactly one in `src/host/tools-rpc.ts`: it turns an ask on one of the tools
  RPC's own script calls in flight into a deny, because no one can answer it, and touches nothing else;
- a second argument to `permission.assert`;
- `Plugin.image`;
- imports of private host source, paths inside `@opencode/*` packages, `@opencode/ai`, other private host packages,
  `@opencode-ai/*`, machine-local paths, and `effect` in `src`;
- in `package.json`: dependencies, peers, lifecycle scripts, an unpinned `@opencode/plugin` or another host range.
