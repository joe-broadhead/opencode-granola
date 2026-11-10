# Contributing

Read [AGENTS.md](AGENTS.md) first: it lists the rules for this repository and the APIs that must never appear in it.
[docs/architecture.md](docs/architecture.md) explains how the plugin works.

## Set up

You need Node.js 24 or later, npm, and [Bun](https://bun.sh). CI and releases use Node.js 24 and Bun 1.4.4, the Bun inside stock
OpenCode 2.2.3, 2.2.4, 2.2.5 and 2.2.6.

```sh
npm ci --ignore-scripts
```

### Try a checkout in OpenCode

Build, then point OpenCode at the folder:

```sh
npm run build
```

Add the folder's absolute path to `plugins` in your OpenCode config, and restart OpenCode:

```jsonc
{
  "plugins": ["<path to this folder>"]
}
```

## Check

One command runs every check, in order, and stops at the first failure:

```sh
npm run check
```

| Stage | Script | What it does |
| --- | --- | --- |
| typecheck | `npm run typecheck` | `tsc --noEmit` for the server (`tsconfig.json`), the TUI (`tsconfig.tui.json`) and the tests (`test/tsconfig.json`) |
| lint | `npm run lint` | `scripts/check-forbidden.mjs`: forbidden APIs and imports in `src/`, `test/` and `scripts/`, and the package shape in `package.json` |
| build | `npm run build` | `scripts/build.mjs`: deletes `dist/`, then esbuild bundles the server into `dist/index.js` and the TUI, compiled with Solid's Babel transform, into `dist/tui.js`. Each file is self-contained. |
| icons | `npm run icons` | `node scripts/check-icons.mjs`: the three icons, the manifest's declarations and the tarball's `files` against the family icon contract |
| unit | `npm test` | Vitest: `test/*.test.ts` and `test/tui/*.test.ts`. The TUI render test runs the built `dist/tui.js` under Bun, so build first. |
| host | `npm run test:host` | `bun test ./test/integration`: the plugin from `dist/` in three OpenCode hosts, with Granola's URL routed to the loopback server in `test/synthetic-granola/` |
| pack | `npm run test:pack` | `node test/pack-smoke.mjs`: builds, packs and installs the package, then loads it in stock OpenCode |
| actionlint | `npm run actionlint` | `node scripts/check-workflows.mjs`: `actionlint` parses the workflows as workflows when it is on `PATH`; otherwise it prints a notice, and CI's own `workflows` job runs it |

The host stage runs the same cases in the public `@opencode/sdk` 2.2.3, embedded in the test process, and in stock
`opencode serve` 2.2.3, 2.2.4, 2.2.5 and 2.2.6 (`TESTED_HOSTS` in `src/hosts.ts`, the one list of tested releases) through
`@opencode/client`. It needs Bun and a prior `npm run build`,
because OpenCode loads the plugin from `dist/`. It covers registration, the default rules, prompts and saved
approvals, the per-agent fix, status in each connection state, the export, runs where nobody is present and
unloading.

The pack stage builds explicitly, packs the package and installs the tarball alone into a temporary project with
scripts off. It checks that the tarball holds exactly the `files` whitelist, with no source or JSX and under 1 MB, that
it installs no dependencies, and that `dist/` holds only `index.js` and `tui.js`, with no relative, dynamic or
`require()` import and nothing but modules OpenCode provides. It then loads the installed
package in stock `opencode serve` 2.2.3, 2.2.4, 2.2.5 and 2.2.6, and imports `.` and `./tui` under Bun next to the host
packages, which it installs from the npm registry. It needs npm, Bun and network access to the npm registry.

### Environment variables

| Variable | Effect |
| --- | --- |
| `OPENCODE_BIN_2_2_3`, `OPENCODE_BIN_2_2_4`, `OPENCODE_BIN_2_2_5`, `OPENCODE_BIN_2_2_6` | Paths to stock `opencode` binaries of those versions, used by the host and pack stages. Unset, each stage installs `@opencode/cli@<version>` from npm into a temporary folder, once per version and run. |
| `VITEST_MAX_WORKERS` | The number of Vitest workers for the unit stage. Use `2` on a busy machine. |

For example:

```sh
OPENCODE_BIN_2_2_3=/path/to/opencode-2.2.3 OPENCODE_BIN_2_2_4=/path/to/opencode-2.2.4 \
  OPENCODE_BIN_2_2_5=/path/to/opencode-2.2.5 OPENCODE_BIN_2_2_6=/path/to/opencode-2.2.6 \
  VITEST_MAX_WORKERS=2 npm run check
```

### Isolation

The host and pack stages give each OpenCode its own temporary folder, holding `HOME`, `OPENCODE_TEST_HOME`, `TMPDIR`
and the four XDG folders. That folder is a git repository under the system's `/tmp`, never under `TMPDIR` or your
home, so OpenCode's upward search cannot pick up your own `.opencode` agents or skills. Bun ignores a changed `HOME`, so `OPENCODE_TEST_HOME` is what moves OpenCode's home. The
embedded host changes into that folder before it starts, because the SDK opens a location at the process working
directory. Stock loads also set `OPENCODE_DISABLE_MODELS_FETCH`, `OPENCODE_DISABLE_AUTOUPDATE` and
`OPENCODE_DISABLE_FREE_MODELS`. Each stage fails unless OpenCode reports its global paths inside that folder; a stock
load fails unless every `opencode debug paths` entry is inside it. OpenCode's outgoing HTTP goes to a closed local
port, so nothing reaches Granola or any other service, and each stock binary runs its own `opencode serve` with its
own password.

When you try something by hand, do the same: set those variables to a temporary folder, start your own
`opencode serve --port <port>` with `OPENCODE_PASSWORD` set, and pass `--server http://127.0.0.1:<port>` to every other
`opencode` command. Without `--server`, commands such as `opencode mcp list` talk to your own OpenCode service. Do not
type prompts into the TUI or `opencode run`: a fresh install answers with a hosted model.

CI (`.github/workflows/ci.yml`) runs `npm ci --ignore-scripts` and `npm run check` on GitHub-hosted Linux x64,
Linux arm64, macOS arm64 and macOS x64 runners.

## Granola's tools

`src/known-tools.ts` lists the Granola tools the plugin knows. `READ_TOOLS` run without a prompt. `WRITE_TOOLS` and
unknown tools follow the `access` option: at the default `"all"` they run, at `"ask-changes"` they ask, and at `"read-only"`
they are denied. `sign_out` is hidden. When `/granola-status` lists a new tool:

1. Read its description and input schema, and Granola's `readOnlyHint` and `destructiveHint` for it.
2. Add it to `READ_TOOLS` only if it never changes anything in Granola or sends anything, because reads run without a
   prompt. Otherwise add it to `WRITE_TOOLS`. If you are not sure, leave it out: it keeps asking.
3. Remove tools that Granola no longer serves.
4. Update the tool lists in `skills/granola/SKILL.md`, `README.md` and the rule block in `docs/configuration.md`.
5. Run `npm run check`, and record the change in `CHANGELOG.md`: it changes the default rules.

## Commits

Use `type(scope): summary`, for example `fix(status): explain a disabled server`. Keep commits small, and keep
`npm run check` green.

### Drift check

The drift check is a manual maintainer check, not part of `npm run check` or CI, and nothing at runtime depends on it.
`npm run drift -- <tools.json> [--strict]` compares a saved copy of Granola's tool list, OpenCode's tool list or an MCP
`tools/list` result, with `src/known-tools.ts`. It names what was added, removed or reclassified, and reads only that
file. `--strict` exits 1 when there is drift.

## Releases

### Versioning

The version follows semantic versioning on the plugin's contract: its options, the tool names and inputs, the
commands, the skill names, the server name `granola`, the RPC method `granola.meetings/status`, the tools RPC `granola.meetings.tools` with `describe` and one method per
known read, and the default rules.
While the major version is 0, a breaking change raises the minor version, and anything else the patch version.

Each release supports one OpenCode range, stated as `opencode.host` in `package.json` and enforced by the host
check, and is tested on the releases in `TESTED_HOSTS` (`src/hosts.ts`), which status, the host stage, the pack stage
and the CI cache key all read. To change the range, update `opencode.host` and `SUPPORTED_RANGE` in
`scripts/check-forbidden.mjs` and `test/pack-smoke.mjs`. To add a tested release, add it to `TESTED_HOSTS`. Update
the Requirements in `README.md` either way. Each `CHANGELOG.md` entry follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

### Releasing

Every plugin releases as `v0.0.0`, and it installs from that GitHub tag. The release is one commit on top of a `master`
head that CI passed, and the tag points at it.

1. Set `version` to `0.0.0` in `package.json`, date the `## [0.0.0]` entry in `CHANGELOG.md`, then run `npm run check`.
2. Push that commit to `master`, and wait for CI to pass on it.
3. In a clean checkout of `master` at that commit, run `node scripts/release-commit.mjs --ci-sha <its full sha>`. It builds
   `dist/`, removes the lifecycle scripts, and creates the signed commit and the signed annotated tag `v0.0.0`. It never
   pushes; `--dry-run` shows the change first.
4. Push the tag only: `git push origin v0.0.0`.
5. Approve the run in the `release` environment. The release workflow checks the tag and its commit, installs the tag on
   each stock OpenCode host (2.2.3 to 2.2.6), packs it, and creates the GitHub Release with the notes, the tarball and
   `SHA256SUMS`.

A tag that already exists stops step 3. Delete the old tag and its Release first, then start again.

Each release has its own tag, and a Git install does not update by itself. To move to a newer release, remove the old entry with `opencode plugin remove github:joe-broadhead/opencode-granola#v0.0.0`, then add the new tag with `opencode plugin add github:joe-broadhead/opencode-granola#v<version>`.

Or add the plugin to `opencode.json` instead, with the same spec:

```json
{ "plugins": [{ "package": "github:joe-broadhead/opencode-granola#v0.0.0" }] }
```
