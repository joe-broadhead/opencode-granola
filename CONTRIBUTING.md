# Contributing

Read [AGENTS.md](AGENTS.md) first: it lists the rules for this repository and the APIs that must never appear in it.
[docs/architecture.md](docs/architecture.md) explains how the plugin works.

## Set up

You need Node.js 24 or later, npm, and [Bun](https://bun.sh). CI and releases use Node.js 24 and Bun 1.4.4, the Bun inside stock
OpenCode 2.2.3 and 2.2.4.

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

A folder extracted from an `npm pack` tarball works the same way.

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
| unit | `npm test` | Vitest: `test/*.test.ts` and `test/tui/*.test.ts`. The TUI render test runs the built `dist/tui.js` under Bun, so build first. |
| host | `npm run test:host` | `bun test ./test/integration`: the plugin from `dist/` in three OpenCode hosts, with Granola's URL routed to the loopback server in `test/synthetic-granola/` |
| pack | `npm run test:pack` | `node test/pack-smoke.mjs`: builds, packs and installs the package, then loads it in stock OpenCode |

The host stage runs the same cases in the public `@opencode/sdk` 2.2.3, embedded in the test process, and in stock
`opencode serve` 2.2.3 and 2.2.4 through `@opencode/client`. It needs Bun and a prior `npm run build`,
because OpenCode loads the plugin from `dist/`. It covers registration, the default rules, prompts and saved
approvals, the per-agent fix, status in each connection state, the export, runs where nobody is present and
unloading.

The pack stage builds explicitly, packs the package and installs the tarball alone into a temporary project with
scripts off. It checks that the tarball holds exactly the `files` whitelist, with no source or JSX and under 1 MB, that
it installs no dependencies, and that `dist/` holds only `index.js` and `tui.js`, with no relative, dynamic or
`require()` import and nothing but modules OpenCode provides. It then loads the installed
package in stock `opencode serve` 2.2.3 and 2.2.4, and imports `.` and `./tui` under Bun next to the host
packages, which it installs from the npm registry. It needs npm, Bun and network access to the npm registry.

### Environment variables

| Variable | Effect |
| --- | --- |
| `OPENCODE_BIN_2_2_3`, `OPENCODE_BIN_2_2_4` | Paths to stock `opencode` binaries of those versions, used by the host and pack stages. Unset, each stage installs `@opencode/cli@<version>` from npm into a temporary folder. |
| `VITEST_MAX_WORKERS` | The number of Vitest workers for the unit stage. Use `2` on a busy machine. |

For example:

```sh
OPENCODE_BIN_2_2_3=/path/to/opencode-2.2.3 OPENCODE_BIN_2_2_4=/path/to/opencode-2.2.4 VITEST_MAX_WORKERS=2 npm run check
```

### Isolation

The host and pack stages give each OpenCode its own temporary folder, holding `HOME`, `OPENCODE_TEST_HOME`, `TMPDIR`
and the four XDG folders. Bun ignores a changed `HOME`, so `OPENCODE_TEST_HOME` is what moves OpenCode's home. The
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

`src/known-tools.ts` lists the Granola tools the plugin knows. `READ_TOOLS` run without a prompt, `WRITE_TOOLS` ask,
`sign_out` is hidden, and anything else asks as an unknown tool. When `/granola-status` lists a new tool:

1. Read its description and input schema, and Granola's `readOnlyHint` and `destructiveHint` for it.
2. Add it to `READ_TOOLS` only if it never changes anything in Granola or sends anything, because reads run without a
   prompt. Otherwise add it to `WRITE_TOOLS`. If you are not sure, leave it out: it keeps asking.
3. Remove tools that Granola no longer serves.
4. Update the tool lists in `skills/granola/SKILL.md`, `README.md` and the rule block in `docs/configuration.md`.
5. Run `npm run check`, and record the change in `CHANGELOG.md`: it changes the default rules.

## Commits

Use `type(scope): summary`, for example `fix(status): explain a disabled server`. Keep commits small, and keep
`npm run check` green.

## Releases

### Versioning

The version follows semantic versioning on the plugin's contract: its options, the tool names and inputs, the
commands, the skill names, the server name `granola`, the RPC method `granola.meetings/status` and the default rules.
While the major version is 0, a breaking change raises the minor version, and anything else the patch version.

Each release supports one tested OpenCode line, stated as `opencode.host` in `package.json` and enforced by the host
check. To change it, update `opencode.host`, `TESTED_HOST` in `scripts/check-forbidden.mjs` and
`test/pack-smoke.mjs`, and `HOST_VERSIONS` in `test/pack-smoke.mjs` and `test/integration/harness.ts`, and the
Requirements in `README.md`. Each `CHANGELOG.md` entry follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

### Releasing

1. On `master`, set `version` in `package.json` and date its `CHANGELOG.md` entry, then run `npm run check`.
2. Tag that commit `v<version>` and push the tag. The release workflow refuses a private package or a tag that differs
   from `version`.
3. Approve the run in the `release` environment.
4. CI runs `npm ci --ignore-scripts` and `npm run check`, packs the tree once, runs
   `node test/pack-smoke.mjs --tarball <file>` on that tarball, and publishes it with
   `npm publish <file> --provenance --access public` through npm trusted publishing, under the dist-tag `latest`, or
   `next` for a prerelease version such as `<version>-rc.1`. A rerun skips a version that is already on npm.

Never unpublish a release. Deprecate it instead, and name the version to use:

```sh
npm deprecate @joe-broadhead/opencode-granola@<version> "<reason>. Use <version> instead."
```
