# Contributing

This repository is an OpenCode plugin on [plugin-contract](https://github.com/we-the-rebel-alliance/plugin-contract) v0.
The contract is [docs/contract.md](https://github.com/we-the-rebel-alliance/plugin-contract/blob/master/docs/contract.md),
the bar for every plugin repository is
[docs/plugin-standard.md](https://github.com/we-the-rebel-alliance/plugin-contract/blob/master/docs/plugin-standard.md),
and [AGENTS.md](AGENTS.md) is the working guide.

## Set up and check

You need Node 24.

```sh
npm ci --ignore-scripts
npm run check
```

`npm run check` runs the whole gate:

| Step | What it proves |
|---|---|
| `npm run lint` | the Biome recommended preset finds no error |
| `npm run typecheck` | the sources and tests typecheck under strict settings |
| `npm run build` | `dist/index.js` is built from `src/index.ts` with esbuild |
| `npm test` | the manifest, accounts, provider, handlers, export, fixture and host-gate tests pass |
| `npm run test:pack` | the packed tarball installs, `opencode plugin add` accepts it, and it starts in OpenCode 2.4.1 |
| `plugin-kit check` | conformance T0 and T1, the doc file set, forbidden patterns and no bundled kit |
| `plugin-kit docs --check` | every generated doc section matches the manifest |

CI runs the same steps in one job named `ci`. `dist/` is generated and is not committed, so CI builds it before
`plugin-kit check`.

## The contract pin

`package.json` pins `github:we-the-rebel-alliance/plugin-contract#v0.0.0`. Move the pin only to a released contract tag,
and move it in its own pull request. Never copy a contract module into this repository.

The committed `package-lock.json` records the contract's repository over `git+ssh`, so a fresh `npm ci` needs the SSH
form rewritten when there is no key. CI runs
`git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"` before `npm ci` for that reason.

## Pull requests

One change per pull request, based on `master`, with a conventional commit (`feat:`, `fix:`, `docs:`, `chore:`). The
pull request says what changed and why, the contract section it implements, and the exact `npm run check` result.
Commits must be signed; the repository rejects an unsigned commit.

A new method, source or action starts in `package.json` `capabilities`, then its handler in `src/handlers/`, then its
tests, then `npm run docs`, then `npm run check`. Every capability has tests, including its negative cases.

## Fixtures

`fixtures/conformance.json` is the plugin's evidence to the conformance kit. It records two synthetic aliases
(`work`, `personal`) driven through the real handlers over a synthetic Granola server that answers in the live text
shapes. `npm run fixtures` rebuilds it; `test/fixture.test.ts` replays it so it cannot drift.

To record from real accounts instead, install the plugin, set two aliases, and run:

```sh
npx plugin-kit record --account work
npx plugin-kit record --account personal
```

`npx plugin-kit record` redacts credentials, emails, phone numbers and home directories before it writes. Do not add a
real person's data to a fixture.

## Releases

Releases are tags, not npm packages. A release is prepared in one pull request, `chore(release): prepare vX.Y.Z`: the
version in `package.json` and `package-lock.json` and the `CHANGELOG.md` section. The owner pushes the tag after
`master`'s CI passed; the release workflow checks the tag, builds, and creates the GitHub release with the packed
tarball, the conformance report and `SHA256SUMS`.
