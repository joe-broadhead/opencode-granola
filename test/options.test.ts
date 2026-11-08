import { describe, expect, it } from "vitest"
import { GranolaError } from "../src/errors.js"
import { ACCESS_VALUES, parseOptions } from "../src/options.js"

const home = "/home/someone"

function failure(raw: unknown): GranolaError {
  try {
    parseOptions(raw, home)
  } catch (error) {
    if (error instanceof GranolaError) return error
    throw error
  }
  throw new Error("expected parseOptions to fail")
}

describe("plugin options", () => {
  it("default to <home>/Granola, the tested host only, and every tool allowed", () => {
    expect(parseOptions(undefined, home)).toEqual({ exportDirectory: "/home/someone/Granola", allowUntestedHost: false, access: "all" })
    expect(parseOptions({}, home)).toEqual({ exportDirectory: "/home/someone/Granola", allowUntestedHost: false, access: "all" })
  })

  it("accept an absolute export directory and the override", () => {
    expect(parseOptions({ exportDirectory: "/data/notes/../Granola", allowUntestedHost: true }, home))
      .toEqual({ exportDirectory: "/data/Granola", allowUntestedHost: true, access: "all" })
  })

  it("accepts every access value", () => {
    for (const access of ACCESS_VALUES) expect(parseOptions({ access }, home).access).toBe(access)
  })

  it("rejects an access value it does not know", () => {
    expect(failure({ access: "write" }).message).toContain('access must be "all" (the default), "ask-changes" or "read-only"')
    expect(failure({ access: 1 }).message).toContain("access must be")
  })

  it("name the unknown key", () => {
    const error = failure({ exportFolder: true })
    expect(error.code).toBe("OPTIONS_INVALID")
    expect(error.message).toContain("exportFolder is not supported")
  })

  it("reject relative or non-string export directories", () => {
    for (const value of ["~/Granola", "Granola", 42, "/tmp/\0x"]) {
      expect(failure({ exportDirectory: value }).message).toContain("exportDirectory must be an absolute path")
    }
  })

  it("reject a non-boolean override and non-object options", () => {
    expect(failure({ allowUntestedHost: "yes" }).message).toContain("allowUntestedHost must be true or false")
    expect(failure(["exportDirectory"]).message).toContain("options must be an object")
  })
})
