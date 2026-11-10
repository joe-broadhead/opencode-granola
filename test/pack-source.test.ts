import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { givenTarball } from "./pack-source.js"

describe("the pack stage's tarball", () => {
  it("tests the tarball that release-pack.mjs names in PACK_TARBALL, the release's own file", () => {
    expect(givenTarball([], { PACK_TARBALL: "/tmp/release/granola-0.0.0.tgz" })).toBe(resolve("/tmp/release/granola-0.0.0.tgz"))
  })

  it("packs the repository itself when neither PACK_TARBALL nor --tarball is set", () => {
    expect(givenTarball(["node", "test/pack-smoke.mjs"], {})).toBeUndefined()
    expect(givenTarball(["node", "test/pack-smoke.mjs"], { PACK_TARBALL: "  " })).toBeUndefined()
  })

  it("takes --tarball for a local run, ahead of PACK_TARBALL", () => {
    expect(givenTarball(["node", "test/pack-smoke.mjs", "--tarball", "out/granola.tgz"], { PACK_TARBALL: "/tmp/other.tgz" })).toBe(
      resolve("out/granola.tgz"),
    )
  })

  it("refuses --tarball with no path", () => {
    expect(() => givenTarball(["node", "test/pack-smoke.mjs", "--tarball"], {})).toThrow("--tarball needs a path")
  })
})
