import { describe, expect, it } from "vitest"
import { GranolaError } from "../src/errors.js"
import { checkHost, satisfies } from "../src/host-check.js"
import { TESTED_HOSTS } from "../src/hosts.js"

const tested = ">=2.2.3 <2.3.0"

describe("supported OpenCode range", () => {
  it("accepts releases inside the line", () => {
    for (const version of ["2.2.3", "2.2.4", "2.2.99"]) expect(satisfies(version, tested), version).toBe(true)
  })

  it("rejects releases outside the line", () => {
    for (const version of ["2.2.2", "2.3.0", "3.0.0", "1.19.5"]) expect(satisfies(version, tested), version).toBe(false)
  })

  it("rejects dev builds, prereleases and malformed versions", () => {
    for (const version of ["0.0.0-dev-202610301200", "2.2.4-beta.1", "2.2.3+build", "local", ""]) {
      expect(satisfies(version, tested), version).toBe(false)
    }
  })

  it("refuses to read a malformed tested range", () => {
    expect(() => satisfies("2.2.3", ">=2.2 <3")).toThrow("PACKAGE_INVALID")
  })
})

describe("checkHost", () => {
  it("names 2.2.3, 2.2.4 and 2.2.5 as the tested releases, all inside the range", () => {
    expect(TESTED_HOSTS).toEqual(["2.2.3", "2.2.4", "2.2.5"])
    for (const version of TESTED_HOSTS) expect(satisfies(version, tested), version).toBe(true)
  })

  it.each(["2.2.3", "2.2.4", "2.2.5"])("passes the tested release %s with no warning", (version) => {
    expect(checkHost(version, tested, false)).toEqual({ version, range: tested, tested: true })
  })

  it("runs another release inside the range, and calls it untested", () => {
    expect(checkHost("2.2.6", tested, false)).toEqual({ version: "2.2.6", range: tested, tested: false })
  })

  it.each(["2.3.0", "0.0.0-dev-202610301200"])("refuses %s with HOST_UNTESTED and the override hint", (version) => {
    let error: unknown
    try { checkHost(version, tested, false) } catch (caught) { error = caught }
    expect(error).toBeInstanceOf(GranolaError)
    expect((error as GranolaError).code).toBe("HOST_UNTESTED")
    expect((error as GranolaError).message).toContain(`supports OpenCode ${tested}, found ${version}`)
    expect((error as GranolaError).message).toContain("allowUntestedHost to true")
  })

  it("loads an untested host with a warning when allowUntestedHost is set", () => {
    expect(checkHost("2.3.0", tested, true)).toEqual({
      version: "2.3.0",
      range: tested,
      tested: false,
      warning: "outside the supported range >=2.2.3 <2.3.0; it runs because allowUntestedHost is true",
    })
  })
})
