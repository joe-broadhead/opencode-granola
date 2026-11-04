// Vitest setup. The shared tools RPC test (test/tools-rpc.test.ts) is a copy of a bun:test file, changed only in its
// two imports, so Bun's toStartWith matcher, which Vitest lacks, is added here rather than in the copy.
import { expect } from "vitest"

declare module "vitest" {
  interface Assertion {
    toStartWith(prefix: string): void
  }
}

expect.extend({
  toStartWith(received: unknown, prefix: string) {
    const pass = typeof received === "string" && received.startsWith(prefix)
    return { pass, message: () => `expected ${JSON.stringify(received)} ${pass ? "not " : ""}to start with ${JSON.stringify(prefix)}` }
  },
})
