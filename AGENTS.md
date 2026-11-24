# Repository rules

This repository builds `@we-the-rebel-alliance/granola-plugin`, an OpenCode plugin that registers Granola's official MCP
server, `https://mcp.granola.ai/mcp`, under the name `granola`, with default permission rules, a Markdown export,
`/granola-status`, a TUI status dialog and two skills. Read [docs/architecture.md](docs/architecture.md) before you
change code, and [CONTRIBUTING.md](CONTRIBUTING.md) for the checks and releases.

The family is moving to plugin-contract v0 (`we-the-rebel-alliance/plugin-contract#50`). Until that release, the
`sources` and `jelly` keys in `package.json`, the copied scripts under `scripts/`, and the Jelly test support stay as
they are: the contract release replaces them.

## Rules

- **Public APIs only:** `@opencode/plugin` 2.4.1 in `src`, plus `@opencode/sdk` and `@opencode/client` in tests. The
  supported range is `opencode.host` in `package.json`, exactly `>=2.4.1 <2.5.0`; the host check reads it from there.
  `TESTED_HOSTS` in `src/hosts.ts` is the one list of tested releases (2.4.1); status calls only those tested, and the
  host and pack tests run on each.
- **Fixed context.** The Code Mode namespace line is at most 400 characters and each skill description at most 300.
  Nothing is pinned, there are no per-request hooks (a cost line belongs in `status`), and nothing outside the plugin
  names its tools. `test/tools.test.ts` and `test/skills.test.ts` hold those budgets.
- **One owner per job.** The namespace line counters Granola's server text where it claims another owner's job or asks
  for an unprompted action: `give_feedback` only when the user asks, and Memory first for who the user is.
- **Greenfield.** No migration code, compatibility paths or dead code, exports, dependencies, docs or tests. Delete
  rather than deprecate.
- **No runtime dependencies or peers.** OpenCode packages, OpenTUI and Solid are devDependencies. Ship prebuilt
  JavaScript with no lifecycle scripts and no declaration files.
- **The icons.** `assets/icon.svg`, `assets/icon-128.png` and `assets/icon-256.png` are Granola's own mark, the swirl
  from granola.ai's logo on Granola's lime, as in Granola's app icon; don't redraw or recolour it. The README carries
  the trademark line and `opencode.vendor.mark` is `true`. `scripts/check-icons.mjs` checks them: `opencode.icons`,
  `jelly.icon`, the three `exports` and the three `files` entries are the only places they are described, and
  `opencode.vendor` declares Granola.
- **Two self-contained bundles.** `scripts/build.mjs` (esbuild) writes only `dist/index.js` and `dist/tui.js`. Neither
  imports a sibling file; only `@opencode/plugin`, OpenTUI, Solid and `node:*` stay external. `tsc` only typechecks.
- **Nothing always visible.** Status lives in `/granola-status` and the `/granola` dialog.
- **One status model.** `src/status.ts` builds it; the rows are Connection, Account, Access, Export folder, Skills,
  Tools, Agents without default rules (`none` when empty), OpenCode and exactly one Next step. The status RPC carries
  the shared fields `version`, `host`, `state` (machine form, such as `sign_in_required`), `access`, `unguardedAgents`
  and `nextStep`, and maps a failed read to its error `unavailable`.
- **Default rules, not hooks.** `ctx.agent.transform` inserts the block from `defaultRules(access)` in
  `src/permissions.ts` after each agent's base allow and never weakens a stricter agent. Agents that miss it, and whose
  own rules would let an unknown Granola tool run without asking, are named by status, with the block to paste.
- **Every tool is allowed by default.** The one option that restricts the plugin is `access`: `"all"` (the default),
  `"ask-changes"` (reads run, everything else asks) and `"read-only"` (reads run, everything else is denied). The block
  is generated from the tool lists, status and the README print it in full, and `test/docs.test.ts` asserts the printed
  block equals `defaultRules(access)` for each value. A tool Granola adds later is covered by `granola_*`, so it follows
  `access` too. There is no deny in the default block.
- **Granola's tools stay Granola's.** Classify them in `src/known-tools.ts` to match the live server; unknown tools
  follow the `access` option. `sign_out` stays hidden.
- **Errors** are `CODE: what happened. Next step: one step.` Upstream errors pass through unchanged, except in the
  tools RPC for scripts, which gives Granola's first line only, redacted, as `UPSTREAM_ERROR`. `PLUGIN_CODES` and
  `RPC_CODES` in `src/errors.ts` are the one table: `test/error-tables.test.ts` fails when a code raised in `src` is in
  neither, or when the README's Troubleshooting table or docs/scripting.md's refusal table drifts from it.
- **Scripts.** The tools RPC, `granola.meetings.tools`, makes every known tool a method with its class: the reads,
  Granola's writes, `give_feedback` (a send) and the plugin's `export_markdown` (an export, confined to the export
  root), and the plugin's own reads `events_list` and `probe`. `sign_out` is not a tool this plugin offers, and an
  unknown tool never is. A call resolves the rule before dispatch: only an allow runs, an ask or a deny is refused with
  no tool call, and `describe` reports each class, plus each method's permission when given a session. The transport is
  the source contract's `tools-rpc` module (`@we-the-rebel-alliance/source-contract`, a devDependency bundled into
  `dist/index.js`); `src/tools-rpc.ts` is Granola's part of it, one `ToolsRpcPlugin` value and the method table. The
  executor it calls skips tool hooks, so `shapeResult` applies the hook's work itself.
- **Sources.** `package.json`'s `sources` declares `granola.meetings` and the list snapshot `granola.meetings.list`.
  `events_list` (`granola_events_list`, a tool and a tools RPC method) lists the meetings the user took part in, and
  `probe` (`granola_probe`, a tools RPC method only) names who is signed in. `src/events/` reads Granola's text and
  implements both with the package's `events` and `cursor` modules. `probe` alone reads `get_account_info`, the
  source's identity operation; a listing never does: it names its account, the signed-in email `probe` answers, and
  get_meetings' `<connected_user_email>` (element or attribute) must be that account, and an answer that holds
  meetings and names none is `UNAVAILABLE`; the list snapshot reads `search_meetings` over the last 29 days and verifies
  its account through `get_meetings` the same way. Its `list` input is on the tools RPC method only: the model tool
  lists events, never a list. `probe` records the account's plan (`mcp_plan`) in memory for a day (`PLAN_TTL_MS`); a
  listing on the free plan, or with none recorded, that starts more than 29 days back answers a `window-truncated` gap
  once and restarts at that gap line, which its cursor carries (`w`) so a later page of the read is held to the whole
  30 days. The descriptor's accounts are named (`accounts.named: true`). `test/conformance.test.ts` runs the package's
  conformance kit over the declaration on a synthetic Granola on the free plan, so the gap is exercised, and writes
  `reports/conformance-report.json`.
- **Text** in skills, errors and status is plain language with no process terms (`test/ux.test.ts`). Docs describe
  what the code does now. No tokens, sign-in links, meeting content or personal data anywhere; test data is invented.
- **Hosts.** The plugin runs on OpenCode 2.4.1. The host suite runs the public `@opencode/sdk` in-process and a stock
  `opencode serve` 2.4.1, both with the same cases. The embedded host gets the automation scheduler a server process
  would start, through an override that forks `Automation.run` (`test/integration/harness.ts`).
- **Releases** come only from `.github/workflows/release.yml` ("Releasing" in [CONTRIBUTING.md](CONTRIBUTING.md)). A
  release-prep PR sets `version` in `package.json` and the install specs and runs `node scripts/changelog.mjs release`;
  once it is on `master` and CI passed, start the release with
  `gh workflow run release.yml --ref master -f sha=<its full sha>`. The workflow builds `dist/`, makes the release
  commit on a temporary `release/v<version>` branch, checks and stages everything, and waits for the owner to approve
  the `release` environment; only then does it create the tag `v<version>` and the GitHub Release. Never push a tag or a
  `release/*` branch, and never commit, tag or publish a release by hand. Agents never approve a release, never call the
  deployment-approval API, and never bypass a ruleset or the environment.
- **Tests** use narrow fakes typed against `SetupContext` with `satisfies`. Host tests run isolated hosts with
  Granola's URL routed to `test/synthetic-granola/`, each in a git repository under the system's `/tmp` (never under
  `TMPDIR` or `HOME`) and each stock host on its own port. Never call Granola, never point a CLI at your own OpenCode
  service, and never type a prompt into a real TUI or `opencode run`.
- `npm run check` passes before every commit.

## Forbidden

`npm run lint` (`scripts/check-forbidden.mjs`) rejects, in `src`, `test` and `scripts`:

- `ui.slot` in `src`;
- the deprecated `ctx.generate.text` and `experimental.policies`, and the experimental `experimental.artifact`;
- a permission `evaluate` hook: the tools RPC's one, which turns an ask on one of its own script calls in flight into a
  deny because no one can answer it, comes from the source contract package;
- a second argument to `permission.assert`;
- `Plugin.image`;
- imports of private host source, paths inside `@opencode/*` packages, `@opencode/ai`, other private host packages,
  `@opencode-ai/*`, machine-local paths, and `effect` in `src`;
- in `package.json`: dependencies, peers, lifecycle scripts, an unpinned `@opencode/plugin` or another host range;
- internal process wording, in the code's comments and in every shipped doc: a decision's author, a lane, or a ticket
  of our own has no place in either. State the behaviour instead.
