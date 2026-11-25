import assert from "node:assert/strict"
import { test } from "node:test"
import { assertHost } from "@we-the-rebel-alliance/plugin-contract/register"
import { manifest } from "../src/manifest.ts"

test("a supported OpenCode starts", () => {
  assert.doesNotThrow(() => assertHost({ app: { version: "2.4.1" }, options: {} }, manifest))
})

test("another 2.4 release starts", () => {
  assert.doesNotThrow(() => assertHost({ app: { version: "2.4.9" }, options: {} }, manifest))
})

test("an untested host is refused with HOST_UNTESTED and a next step", () => {
  assert.throws(
    () => assertHost({ app: { version: "2.3.2" }, options: {} }, manifest),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.match(error.message, /^HOST_UNTESTED: /)
      assert.match(error.message, /Next step: /)
      assert.match(error.message, />=2\.4\.1 <2\.5\.0/)
      return true
    },
  )
})

test("allowUntestedHost starts an untested host", () => {
  assert.doesNotThrow(() => assertHost({ app: { version: "2.5.0" }, options: { allowUntestedHost: true } }, manifest))
})
