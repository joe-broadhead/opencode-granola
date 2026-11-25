// Rewrites fixtures/conformance.json from the handlers over the synthetic Granola server.
//
//   npm run fixtures
//
// The synthetic server is deterministic, so every recorded answer can be rebuilt, and `test/fixture.test.ts` replays
// the file through the same handlers so it cannot drift. A plugin with real accounts records with
// `npx plugin-kit record --account <alias>` instead.
import { mkdirSync, writeFileSync } from "node:fs"
import { buildFixture } from "../test/support/fixture.ts"

const fixture = await buildFixture()
mkdirSync("fixtures", { recursive: true })
writeFileSync("fixtures/conformance.json", `${JSON.stringify(fixture, null, 2)}\n`)
console.log("recorded fixtures/conformance.json")
