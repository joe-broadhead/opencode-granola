// The host test on the public `@opencode/sdk` host, embedded in this process. `npm run test:host` runs it under Bun,
// which serves the vitest imports from bun:test; build first with `npm run build`, since OpenCode loads dist/.
import { afterAll, beforeAll } from "vitest"
import { startSyntheticGranola, type SyntheticGranola } from "../synthetic-granola/server.js"
import { startEmbedded } from "./harness.js"
import { hostSuite } from "./suite.js"

let fake: SyntheticGranola
beforeAll(async () => {
  fake = await startSyntheticGranola()
})
afterAll(async () => {
  await fake?.close()
})

hostSuite("embedded @opencode/sdk", (server) => startEmbedded(server), () => fake)
