// The host test on each stock OpenCode release, through `opencode serve` and the public client. Set OPENCODE_BIN_2_2_3
// and OPENCODE_BIN_2_2_4 to binaries you already have; otherwise each release is installed into a temp directory.
import { afterAll, beforeAll } from "vitest"
import { startSyntheticGranola, type SyntheticGranola } from "../synthetic-granola/server.js"
import { HOST_VERSIONS, startBinary } from "./harness.js"
import { hostSuite } from "./suite.js"

let fake: SyntheticGranola
beforeAll(async () => {
  fake = await startSyntheticGranola()
})
afterAll(async () => {
  await fake?.close()
})

for (const version of HOST_VERSIONS) hostSuite(`stock opencode ${version}`, (server) => startBinary(version, server), () => fake)
