import { createHash } from "node:crypto"
import { promises as fs } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MarkdownExportRefusal, writeMarkdownExport, type MarkdownExportOptions } from "../src/io/markdown-export.js"

describe("bounded Markdown export", () => {
  let temporary: string
  let root: string
  let outside: string
  let destination: string

  beforeEach(async () => {
    temporary = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "markdown-export-test-")))
    root = path.join(temporary, "allowed")
    outside = path.join(temporary, "allowed-other")
    await fs.mkdir(root)
    await fs.mkdir(outside)
    destination = path.join(root, "notes.md")
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(temporary, { recursive: true, force: true })
  })

  function write(options: Partial<MarkdownExportOptions> = {}) {
    return writeMarkdownExport({
      destination,
      markdown: "# Meeting\n\nCafé ☕\n",
      maxBytes: 1024,
      allowedRoots: [root],
      ...options,
    })
  }

  async function expectNoStaging(directory = root) {
    expect((await fs.readdir(directory)).filter((name) => name.startsWith(".markdown-export-"))).toEqual([])
  }

  it("writes exact UTF-8 bytes with a canonical path, SHA-256, and private modes", async () => {
    const link = fs.link.bind(fs)
    const publish = vi.spyOn(fs, "link").mockImplementation(async (source, target) => {
      expect(path.dirname(path.dirname(String(source)))).toBe(root)
      expect((await fs.stat(path.dirname(String(source)))).mode & 0o777).toBe(0o700)
      expect((await fs.stat(source)).mode & 0o777).toBe(0o600)
      await link(source, target)
    })
    const result = await write()
    const data = await fs.readFile(destination)
    expect(result).toEqual({
      path: destination,
      bytes: Buffer.byteLength("# Meeting\n\nCafé ☕\n"),
      sha256: createHash("sha256").update(data).digest("hex"),
    })
    expect(data.toString("utf8")).toBe("# Meeting\n\nCafé ☕\n")
    expect(publish).toHaveBeenCalledOnce()
    await expectNoStaging()
  })

  it("accepts existing nested parents and multiple roots", async () => {
    const nested = path.join(root, "nested")
    await fs.mkdir(nested)
    await write({ destination: path.join(nested, "notes.md"), allowedRoots: [outside, root] })
    expect(await fs.readdir(nested)).toEqual(["notes.md"])
    expect(await fs.readdir(outside)).toEqual([])
  })

  it("never creates a missing parent", async () => {
    await expect(write({ destination: path.join(root, "missing", "notes.md") })).rejects.toMatchObject({ code: "ENOENT" })
    expect(await fs.readdir(root)).toEqual([])
  })

  it.each(["relative.md", "/outside.md"])("rejects an unauthorized destination %s", async (value) => {
    await expect(write({ destination: value })).rejects.toThrow()
    expect(await fs.readdir(root)).toEqual([])
  })

  it("rejects sibling-prefix and parent-traversal escapes", async () => {
    await expect(write({ destination: path.join(outside, "notes.md") })).rejects.toThrow("outside")
    await expect(write({ destination: `${root}/../allowed-other/notes.md` })).rejects.toThrow("traversal")
    expect(await fs.readdir(outside)).toEqual([])
  })

  it("requires every configured root to be absolute, existing, and a directory", async () => {
    const file = path.join(temporary, "file")
    await fs.writeFile(file, "original")
    for (const allowedRoots of [[], ["relative"], [path.join(temporary, "missing")], [file], [root, "relative"]]) {
      await expect(write({ allowedRoots })).rejects.toThrow()
    }
    expect(await fs.readdir(root)).toEqual([])
  })

  it("rejects a symlink allowed root", async () => {
    const alias = path.join(temporary, "alias")
    await fs.symlink(root, alias)
    await expect(write({ allowedRoots: [alias], destination: path.join(alias, "notes.md") })).rejects.toThrow("symlink")
    expect(await fs.readdir(root)).toEqual([])
  })

  it.each([false, true])("rejects parent symlinks even when they stay inside the root (inside=%s)", async (inside) => {
    const directory = inside ? path.join(root, "real") : outside
    if (inside) await fs.mkdir(directory)
    const alias = path.join(root, "alias")
    await fs.symlink(directory, alias)
    await expect(write({ destination: path.join(alias, "notes.md") })).rejects.toThrow("symlink")
    expect(await fs.readdir(directory)).toEqual([])
    await expectNoStaging()
  })

  it.each([false, true])("rejects final symlinks, including dangling links (overwrite=%s)", async (overwrite) => {
    const victim = path.join(outside, "victim.md")
    await fs.writeFile(victim, "original")
    await fs.symlink(victim, destination)
    await expect(write({ overwrite })).rejects.toThrow("symlink")
    expect(await fs.readFile(victim, "utf8")).toBe("original")
    await fs.unlink(victim)
    await expect(write({ overwrite })).rejects.toThrow("symlink")
    expect((await fs.lstat(destination)).isSymbolicLink()).toBe(true)
    expect(await fs.readdir(outside)).toEqual([])
    await expectNoStaging()
  })

  it("gives each refusal a reason that callers can map to their own errors", async () => {
    const file = path.join(root, "file")
    await fs.writeFile(file, "x")
    await fs.mkdir(path.join(root, "folder"))
    await fs.symlink(outside, path.join(root, "alias"))
    await fs.symlink(path.join(outside, "victim.md"), path.join(root, "link.md"))
    for (const [options, reason] of [
      [{ destination: path.join(outside, "notes.md") }, "outside"],
      [{ destination: path.join(root, "alias", "notes.md") }, "link"],
      [{ destination: path.join(root, "link.md"), overwrite: true }, "link"],
      [{ destination: path.join(root, "folder"), overwrite: true }, "not-a-file"],
      [{ destination: path.join(file, "notes.md") }, "not-a-file"],
      [{ markdown: "too long", maxBytes: 3 }, "too-large"],
    ] as const) {
      const failure = await write(options).catch((error: unknown) => error)
      expect(failure, JSON.stringify(options)).toBeInstanceOf(MarkdownExportRefusal)
      expect(failure).toMatchObject({ name: "MarkdownExportRefusal", reason })
    }
    const realpath = fs.realpath.bind(fs)
    let calls = 0
    vi.spyOn(fs, "realpath").mockImplementation(async (target) => (++calls > 1 ? `${await realpath(target)}-moved` : realpath(target)))
    await expect(write()).rejects.toMatchObject({ reason: "changed" })
    await expect(fs.lstat(destination)).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("preserves existing files by default and rejects directory targets even with overwrite", async () => {
    await fs.writeFile(destination, "original")
    await expect(write()).rejects.toMatchObject({ code: "EEXIST" })
    expect(await fs.readFile(destination, "utf8")).toBe("original")
    await fs.unlink(destination)
    await fs.mkdir(destination)
    await expect(write({ overwrite: true })).rejects.toThrow("regular file")
    await expectNoStaging()
  })

  it("overwrites only explicitly, replacing rather than modifying the old inode", async () => {
    const alias = path.join(outside, "hardlink.md")
    await fs.writeFile(destination, "original")
    await fs.link(destination, alias)
    await write({ overwrite: true, markdown: "replacement" })
    expect(await fs.readFile(destination, "utf8")).toBe("replacement")
    expect(await fs.readFile(alias, "utf8")).toBe("original")
    await expectNoStaging()
  })

  it("enforces the encoded-byte cap before staging and allows the exact boundary", async () => {
    const mkdir = vi.spyOn(fs, "mkdtemp")
    await expect(write({ markdown: "é😀", maxBytes: 5 })).rejects.toThrow("UTF-8")
    expect(mkdir).not.toHaveBeenCalled()
    const result = await write({ markdown: "é😀", maxBytes: 6 })
    expect(result.bytes).toBe(6)
    expect(await fs.readFile(destination, "utf8")).toBe("é😀")
    await expectNoStaging()
  })

  it("supports an empty file with a zero-byte cap and rejects invalid caps", async () => {
    for (const maxBytes of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(write({ maxBytes })).rejects.toThrow("safe integer")
    }
    expect((await write({ markdown: "", maxBytes: 0 })).bytes).toBe(0)
    expect(await fs.readFile(destination, "utf8")).toBe("")
  })

  it("rejects a non-boolean overwrite grant at runtime", async () => {
    await expect(write({ overwrite: "true" as unknown as boolean })).rejects.toThrow("boolean")
    expect(await fs.readdir(root)).toEqual([])
  })

  it("does no staging for an already cancelled request", async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(write({ signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" })
    expect(await fs.readdir(root)).toEqual([])
  })

  it("cleans private staging when cancelled immediately after its creation", async () => {
    const controller = new AbortController()
    const mkdtemp = fs.mkdtemp.bind(fs)
    vi.spyOn(fs, "mkdtemp").mockImplementationOnce(async (prefix) => {
      const directory = await mkdtemp(prefix)
      controller.abort()
      return directory
    })
    await expect(write({ signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" })
    expect(await fs.readdir(root)).toEqual([])
  })

  it("cleans a partially written staging file after cancellation", async () => {
    const controller = new AbortController()
    const open = fs.open.bind(fs)
    vi.spyOn(fs, "open").mockImplementationOnce(async (...args) => {
      const handle = await open(...args)
      const writeFile = handle.writeFile.bind(handle)
      vi.spyOn(handle, "writeFile").mockImplementationOnce(async () => {
        await writeFile("partial")
        controller.abort()
      })
      return handle
    })
    await expect(write({ signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" })
    expect(await fs.readdir(root)).toEqual([])
  })

  it("cleans failed writes and preserves an overwrite destination", async () => {
    await fs.writeFile(destination, "original")
    const open = fs.open.bind(fs)
    vi.spyOn(fs, "open").mockImplementationOnce(async (...args) => {
      const handle = await open(...args)
      const writeFile = handle.writeFile.bind(handle)
      vi.spyOn(handle, "writeFile").mockImplementationOnce(async () => {
        await writeFile("partial")
        throw Object.assign(new Error("disk full"), { code: "ENOSPC" })
      })
      return handle
    })
    await expect(write({ overwrite: true })).rejects.toMatchObject({ code: "ENOSPC" })
    expect(await fs.readFile(destination, "utf8")).toBe("original")
    await expectNoStaging()
  })

  it("atomically refuses a competing file created after the final target check", async () => {
    const link = fs.link.bind(fs)
    vi.spyOn(fs, "link").mockImplementationOnce(async (source, target) => {
      await fs.writeFile(target, "competitor", { flag: "wx" })
      await link(source, target)
    })
    await expect(write()).rejects.toMatchObject({ code: "EEXIST" })
    expect(await fs.readFile(destination, "utf8")).toBe("competitor")
    await expectNoStaging()
  })

  it("rechecks the final target after staging and rejects a newly introduced symlink", async () => {
    const victim = path.join(outside, "victim.md")
    await fs.writeFile(victim, "original")
    const open = fs.open.bind(fs)
    vi.spyOn(fs, "open").mockImplementationOnce(async (...args) => {
      const handle = await open(...args)
      await fs.symlink(victim, destination)
      return handle
    })
    await expect(write({ overwrite: true })).rejects.toThrow("symlink")
    expect(await fs.readFile(victim, "utf8")).toBe("original")
    expect((await fs.lstat(destination)).isSymbolicLink()).toBe(true)
    await expectNoStaging()
  })

  it("cleans staging on placement failure without a non-atomic copy fallback", async () => {
    vi.spyOn(fs, "link").mockRejectedValueOnce(Object.assign(new Error("unsupported link"), { code: "EXDEV" }))
    await expect(write()).rejects.toMatchObject({ code: "EXDEV" })
    expect(await fs.readdir(root)).toEqual([])
  })

  it("has exactly one winner among concurrent default writes", async () => {
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => write({ markdown: `writer ${i}` })))
    const winners = results.filter((result) => result.status === "fulfilled")
    expect(winners).toHaveLength(1)
    const data = await fs.readFile(destination)
    if (winners[0]?.status === "fulfilled") {
      expect(winners[0].value.sha256).toBe(createHash("sha256").update(data).digest("hex"))
    }
    await expectNoStaging()
  })

  it("returns the committed result when an abort races with successful publication", async () => {
    const controller = new AbortController()
    const link = fs.link.bind(fs)
    vi.spyOn(fs, "link").mockImplementationOnce(async (source, target) => {
      await link(source, target)
      controller.abort()
    })
    await expect(write({ signal: controller.signal })).resolves.toMatchObject({ path: destination })
    await expectNoStaging()
  })

  it.each([false, true])("reports committed success with degraded cleanup when rmdir fails (overwrite=%s)", async (overwrite) => {
    if (overwrite) await fs.writeFile(destination, "original")
    const rmdir = fs.rmdir.bind(fs)
    const cleanup = vi.spyOn(fs, "rmdir").mockImplementation(async (directory, options) => {
      if (path.dirname(String(directory)) === root && path.basename(String(directory)).startsWith(".markdown-export-")) {
        throw Object.assign(new Error("cleanup denied"), { code: "EACCES" })
      }
      await rmdir(directory, options)
    })
    const result = await write({ overwrite, markdown: "committed" })
    expect(result).toEqual({
      path: destination,
      bytes: 9,
      sha256: createHash("sha256").update("committed").digest("hex"),
      cleanupDegraded: true,
    })
    expect(await fs.readFile(destination, "utf8")).toBe("committed")
    const leftovers = (await fs.readdir(root)).filter((name) => name.startsWith(".markdown-export-"))
    expect(leftovers).toHaveLength(1)
    expect(await fs.readdir(path.join(root, leftovers[0]!))).toEqual([])
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it("reports degraded cleanup when a staging hard link remains after publication", async () => {
    const unlink = fs.unlink.bind(fs)
    vi.spyOn(fs, "unlink").mockImplementation(async (file) => {
      if (path.dirname(path.dirname(String(file))) === root && path.basename(String(file)) === "content.md") {
        throw Object.assign(new Error("cleanup denied"), { code: "EACCES" })
      }
      await unlink(file)
    })
    const rmdir = vi.spyOn(fs, "rmdir")
    const result = await write({ markdown: "committed" })
    expect(result.cleanupDegraded).toBe(true)
    expect(await fs.readFile(destination, "utf8")).toBe("committed")
    const leftovers = (await fs.readdir(root)).filter((name) => name.startsWith(".markdown-export-"))
    expect(leftovers).toHaveLength(1)
    const stagedFile = path.join(root, leftovers[0]!, "content.md")
    expect(await fs.readFile(stagedFile, "utf8")).toBe("committed")
    expect((await fs.stat(stagedFile)).ino).toBe((await fs.stat(destination)).ino)
    expect(rmdir).toHaveBeenCalledOnce()
  })

  it.each([false, true])("preserves the original publication error when both cleanup operations fail (overwrite=%s)", async (overwrite) => {
    if (overwrite) await fs.writeFile(destination, "original")
    const failure = Object.freeze(Object.assign(new Error("publication denied"), { code: "EACCES" }))
    vi.spyOn(fs, overwrite ? "rename" : "link").mockRejectedValueOnce(failure)
    const unlink = fs.unlink.bind(fs)
    const removeFile = vi.spyOn(fs, "unlink").mockImplementation(async (file) => {
      if (path.dirname(path.dirname(String(file))) === root && path.basename(String(file)) === "content.md") {
        throw Object.assign(new Error("cleanup denied"), { code: "EPERM" })
      }
      await unlink(file)
    })
    const removeDirectory = vi.spyOn(fs, "rmdir")
    await expect(write({ overwrite, markdown: "unpublished" })).rejects.toBe(failure)
    if (overwrite) {
      expect(await fs.readFile(destination, "utf8")).toBe("original")
    } else {
      await expect(fs.lstat(destination)).rejects.toMatchObject({ code: "ENOENT" })
    }
    const leftovers = (await fs.readdir(root)).filter((name) => name.startsWith(".markdown-export-"))
    expect(leftovers).toHaveLength(1)
    expect(await fs.readFile(path.join(root, leftovers[0]!, "content.md"), "utf8")).toBe("unpublished")
    expect(removeFile).toHaveBeenCalledOnce()
    expect(removeDirectory).toHaveBeenCalledOnce()
  })
})
