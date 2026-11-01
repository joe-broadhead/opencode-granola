import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { defaultName, exportPath, preflight, prepare } from "../src/export/paths.js"

async function failure(promise: Promise<unknown> | (() => unknown)): Promise<{ message: string; metadata?: { code?: string } }> {
  try {
    await (typeof promise === "function" ? promise() : promise)
  } catch (error) {
    return error as { message: string; metadata?: { code?: string } }
  }
  throw new Error("expected a failure")
}

describe("export paths", () => {
  it("names a new file after the content and the time", () => {
    expect(defaultName("both", new Date("2026-10-30T14:05:09.123Z"))).toBe("granola-both-20261030-140509Z.md")
  })

  it.each([
    ["notes.md", ["notes.md"]],
    ["meetings/2026/weekly sync", ["meetings", "2026", "weekly sync.md"]],
    ["Notes.MARKDOWN", ["Notes.MARKDOWN"]],
    ["report.txt", ["report.txt.md"]],
  ])("accepts %s", (raw, parts) => {
    expect(exportPath(raw)).toEqual(parts)
  })

  it.each([
    ["../notes.md", "leaves the export folder"],
    ["meetings/../../notes.md", "leaves the export folder"],
    ["/etc/notes.md", "is absolute"],
    ["~/notes.md", "is absolute"],
    ["C:/notes.md", "is absolute"],
    ["meetings\\notes.md", "uses `\\`"],
    ["meetings//notes.md", "empty folder or file name"],
    ["meetings/", "empty folder or file name"],
    [".hidden/notes.md", "hidden file or folder"],
    ["./notes.md", "hidden file or folder"],
    ["notes\n.md", "control characters"],
    [`${"a".repeat(253)}.txt`, "longer than 255 bytes"],
  ])("refuses %j with a clear error", async (raw, reason) => {
    const error = await failure(() => exportPath(raw))
    expect(error.metadata?.code).toBe("EXPORT_INVALID_PATH")
    expect(error.message).toContain(reason)
    expect(error.message).toContain("Next step: Use a path inside the export folder")
  })
})

describe("export folders", () => {
  let temporary: string
  let root: string
  let outside: string

  beforeEach(async () => {
    temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "granola-export-paths-")))
    root = path.join(temporary, "Granola")
    outside = path.join(temporary, "outside")
    await fs.mkdir(outside)
  })

  afterEach(async () => {
    await fs.rm(temporary, { recursive: true, force: true })
  })

  it("passes the preflight when nothing exists yet, and creates nothing", async () => {
    await preflight(root, ["a", "b", "notes.md"], false)
    await expect(fs.lstat(root)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("refuses an existing target unless overwrite is set", async () => {
    await fs.mkdir(path.join(root, "a"), { recursive: true })
    await fs.writeFile(path.join(root, "a", "notes.md"), "old")
    expect((await failure(preflight(root, ["a", "notes.md"], false))).metadata?.code).toBe("EXPORT_EXISTS")
    await preflight(root, ["a", "notes.md"], true)
  })

  it.each([
    ["a link to a folder outside", async () => fs.symlink(outside, path.join(root, "a")), ["a", "notes.md"], "goes through the link `a`"],
    ["a file in place of a folder", async () => fs.writeFile(path.join(root, "a"), "x"), ["a", "notes.md"], "goes through `a`, which is a file"],
    ["a folder in place of the file", async () => fs.mkdir(path.join(root, "notes.md")), ["notes.md"], "names a folder"],
    ["a link as the file", async () => fs.symlink(path.join(outside, "victim.md"), path.join(root, "notes.md")), ["notes.md"], "goes through the link `notes.md`"],
  ])("refuses %s before asking", async (_label, arrange, parts, reason) => {
    await fs.mkdir(root)
    await arrange()
    const error = await failure(preflight(root, parts, true))
    expect(error.metadata?.code).toBe("EXPORT_INVALID_PATH")
    expect(error.message).toContain(reason)
    expect(await fs.readdir(outside)).toEqual([])
  })

  it("refuses an export folder that is a file", async () => {
    await fs.writeFile(root, "x")
    // Each step starts only when it is awaited, so neither rejects unobserved.
    for (const step of [() => preflight(root, ["notes.md"], false), () => prepare(root, ["notes.md"])]) {
      const error = await failure(step())
      expect(error.metadata?.code).toBe("EXPORT_WRITE_FAILED")
      expect(error.message).toContain("the export folder is a file")
    }
  })

  it("creates the export folder and missing subfolders privately, and returns canonical paths", async () => {
    const target = await prepare(root, ["meetings", "2026", "notes.md"])
    expect(target).toEqual({ root, destination: path.join(root, "meetings", "2026", "notes.md") })
    for (const folder of [root, path.join(root, "meetings"), path.join(root, "meetings", "2026")]) {
      expect((await fs.stat(folder)).mode & 0o777).toBe(0o700)
    }
    await expect(fs.lstat(target.destination)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("follows a configured export folder that is itself a link", async () => {
    await fs.mkdir(path.join(temporary, "real"))
    await fs.symlink(path.join(temporary, "real"), root)
    expect(await prepare(root, ["notes.md"])).toEqual({ root: path.join(temporary, "real"), destination: path.join(temporary, "real", "notes.md") })
  })

  it("never creates a folder through a link inside the export folder", async () => {
    await fs.mkdir(root)
    await fs.symlink(outside, path.join(root, "a"))
    const error = await failure(prepare(root, ["a", "b", "notes.md"]))
    expect(error.metadata?.code).toBe("EXPORT_INVALID_PATH")
    expect(error.message).toContain("goes through `a`, which is not a folder")
    expect(await fs.readdir(outside)).toEqual([])
  })
})
