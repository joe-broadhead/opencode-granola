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

Each release is the GitHub tag `v<version>`, where `<version>` is the `version` in `package.json`, and users install from
that tag. The release is one commit on top of a `master` head that CI passed, and the tag points at it. The release
workflow makes both, in GitHub Actions: nobody builds, commits or tags a release on their own machine, and no personal
key signs it.

While changes land, their notes go under `## [Unreleased]` at the top of `CHANGELOG.md`. Each earlier GitHub release is
a `## [x.y.z] - YYYY-MM-DD` heading below it, newest first, and the npm history stays last, under
`## Earlier releases on npm`.

1. On `master`, set `version` in `package.json` to the new version, and change every install spec in the README,
   `CONTRIBUTING.md` and `docs/` to `#v<version>` (`test/docs.test.ts` fails until they match). Then run
   `node scripts/changelog.mjs release`: it turns `## [Unreleased]` into `## [<version>] - <today>`, above the earlier
   releases, and refuses a CHANGELOG it cannot shape. Run `npm run check`.
2. Push that commit to `master`, and wait for CI to pass on it.
3. Start the release with that commit's full sha:
   `gh workflow run release.yml --ref master -f sha=<full sha>`, or from Actions → release →
   Run workflow, on `master`.
4. Read the run's summary, then approve the `release` environment. The summary is on the run page, under the `stage`
   job: the tag, the parent and its CI run, the release commit and its tree, the sha256 of `SHA256SUMS` and the staged
   artifact's id, `SHA256SUMS` itself, and the notes. Open the release commit on `release/v<version>` and read them
   before approving: the approval releases exactly those bytes. Only the owner approves a release. Agents never approve
   one, never call the deployment-approval API, and never bypass a ruleset or the environment; the kit's scripts make
   only their own GitHub calls and refuse every other.
5. Check the published Release: not a draft, its notes, and every asset against `SHA256SUMS`.

`package.json` stays `"private": true`, so npm can never publish the plugin by accident; a GitHub install does not read
it, and `npm pack` still packs the release tarball. It is kept in its canonical form, `JSON.stringify(pkg, null, 2)` and
one newline: the kit tests check both in `npm run check`, as the release planner does.

Before the approval, the workflow:
- **plans:** refuses a run that is not on `master`, a sha that is not `master`'s head, a sha without a successful
  `ci.yml` push run, a version that is not `x.y.z`, a `package.json` that is not `"private": true` or not in its
  canonical form, a CHANGELOG whose newest release is not this version, a release that does not move forward from the
  last published Release, a leftover `release/v<version>` branch, a native run that did not build this sha on `master`,
  by hand, with success, and a missing `native_run` (or one given to a plugin that is not native);
- **builds** `dist/` with `npm ci --ignore-scripts` and `npm run build`, with a read-only token, and writes the release
  files: `dist/`, `package.json` without its lifecycle scripts, and the vetted native manifest;
- **commits** them on a temporary branch `release/v<version>` at the parent, through GitHub's API with the workflow's token,
  so GitHub signs the commit (author `github-actions[bot]`, committer GitHub). This job runs no npm. It refuses a commit
  that GitHub does not verify, or whose parent or tree is not the one the files give;
- **verifies** on a fresh runner: the commit's identity, one parent on `master`, `package.json` exactly the parent's
  without the lifecycle scripts, only regular files in the allowed paths, no `package.json` under `dist/`, and a second,
  independent build of the parent (its own job) equal to the committed `dist/` byte for byte;
- **installs** the release commit with `plugin add` on each stock OpenCode host (2.2.3 to 2.2.6);
- **packs** the commit before installing anything and keeps that tarball, then runs the pack stage against a copy;
- **stages** the Release: verifies the attested native files, writes `SHA256SUMS` and the notes (the version's CHANGELOG
  section), and shows them all in the run summary with the sha256 of `SHA256SUMS`.

A job either runs repository or dependency code (`npm ci`, the build, the pack stage, a host install) and has no write
token, or uses the API and runs only the kit's scripts on a fresh checkout, after checking that the release commit's
`scripts/` and `.github/` are the parent's. The first kind is not token-free: `actions/checkout` fetches with the job's
read-only (`contents: read`) token, and its post step and the artifact uploads run after repository code on the same
runner, so that code could reach a read-only token for this public repository and the runner's artifact token. Jobs
pass files as artifacts downloaded by the id the uploading job gave, and each is checked again on arrival.

After the approval, it downloads the staged artifact by the id the summary names, and refuses unless `SHA256SUMS` has
the sha256 the summary shows and every staged file matches it, and every native file is the one the release commit's
`manifest/native.json` pins, size and sha256, with each gzip holding the pinned executable. Then it checks everything again, creates the annotated tag
`v<version>` on the release commit (tagger `github-actions[bot]`, unsigned), checks the tag, creates the Release with the
notes, the tarball, the native files and `SHA256SUMS`, and deletes `release/v<version>`. The tag keeps the commit.

GitHub's signature and the bot identity show only that GitHub made the commit through its API for the workflow; anyone
with write access can make such a commit. What ties the release to `master` is its content: one parent CI passed, the
exact `package.json`, the allowed paths and the byte-for-byte rebuild. Never relax those because the commit is signed.

**A rejected, expired or failed run** leaves nothing behind: the `cleanup` job deletes `release/v<version>` when it points
at the parent or at that run's commit, and never touches another branch. No tag exists before the approval, so the
version is not burned: fix `master` and start again. If `cleanup` itself failed, the next run refuses until the branch
is deleted: `gh api -X DELETE repos/joe-broadhead/opencode-granola/git/refs/heads/release/v<version>`.

**Resume.** If the run fails after creating the tag and before the Release is complete, start it again with the same `sha`. The plan finds the kit's tag on a release commit on that sha with no published Release, and resumes:
it makes no new commit, checks and installs the tagged commit, stages the files, and after a new approval reuses the tag
and adds what the Release lacks. Delete a draft Release a failed upload left first: the publish step refuses a draft.
Any other existing tag is refused: release the next version.

The repository's tag ruleset keeps a `v*` tag from being moved or deleted. A stray `v*` tag, one that never became a
Release, does not block later releases: only published Releases count, and drafts do not. Its version cannot be
released, so release the next one. To remove the tag anyway, an admin disables the `release tags` ruleset, deletes the
tag, and restores the ruleset exactly as it was.

**Known limit: a `v*` tag pushed by hand.** No ruleset limits who creates a `v*` tag, so anyone with write access can
push one by hand, pointing at any commit. Such a tag has no published Release, the forward-only check ignores it, and
Jelly installs only a published Release whose `SHA256SUMS` it verifies. But a user who installs
`github:joe-broadhead/opencode-granola#v<x>` directly gets whatever that tag points at. Only the release workflow makes
release tags; never push one by hand.

The release kit is these files, the same in every plugin: `scripts/release-rules.mjs`, `scripts/release-commit.mjs`,
`scripts/release-github.mjs`, `scripts/check-release-shape.mjs`, `scripts/changelog.mjs`, `scripts/release-version.mjs`,
`scripts/release-pack.mjs`, `scripts/publish-release.mjs`, `scripts/attach-native.mjs`, `scripts/native-manifest.mjs`,
`scripts/tested-hosts.mjs`, `scripts/check-release-plugin-add.sh`, `scripts/release-kit.test.mjs` and
`.github/workflows/release.yml`. Do not re-run the older `apply-release-kit.mjs`: it writes back the kit that could
release only `v0.0.0`.

Each release has its own tag, and a Git install does not update by itself. To move to a newer release, remove the old entry with `opencode plugin remove github:joe-broadhead/opencode-granola#v<old version>`, then add the new tag with `opencode plugin add github:joe-broadhead/opencode-granola#v<version>`.

Or add the plugin to `opencode.json` instead, with the same spec:

```json
{ "plugins": [{ "package": "github:joe-broadhead/opencode-granola#v0.0.1" }] }
```
