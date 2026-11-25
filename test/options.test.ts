import assert from "node:assert/strict"
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"
import { test } from "node:test"
import { exportDirectoryOf } from "../src/index.ts"

test("the default export folder is ~/Granola", () => {
  assert.equal(exportDirectoryOf({}), join(homedir(), "Granola"))
})

test("a leading ~/ expands to the home folder, and the result is absolute", () => {
  const folder = exportDirectoryOf({ exportDirectory: "~/Granola" })
  assert.equal(folder, join(homedir(), "Granola"))
  assert.equal(isAbsolute(folder), true)
  assert.equal(exportDirectoryOf({ exportDirectory: "~/x" }), join(homedir(), "x"))
  assert.equal(exportDirectoryOf({ exportDirectory: "~" }), homedir())
})

test("an absolute export folder is kept", () => {
  const folder = join(homedir(), "Exports")
  assert.equal(exportDirectoryOf({ exportDirectory: folder }), folder)
})

test("a relative export folder is refused with OPTIONS_INVALID", () => {
  for (const value of ["Granola", "../Granola", "~other/Granola"]) {
    assert.throws(
      () => exportDirectoryOf({ exportDirectory: value }),
      (error: unknown) => error instanceof Error && error.message.startsWith("OPTIONS_INVALID: ") && error.message.includes("Next step: "),
      value,
    )
  }
})
