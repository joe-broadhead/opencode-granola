import { readFileSync, readdirSync } from "node:fs"
import { relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { describe, expect, it } from "vitest"
import { scanImports, type Policy } from "./import-boundaries.js"

const root = fileURLToPath(new URL("../", import.meta.url))
const tree = resolve(root, "src")

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(resolve(directory, entry.name)) : [resolve(directory, entry.name)])
}

// Public plugin SDK entrypoints only. Tool.Error is exported from the Promise tool subpath, which the
// host redirects to its own instance; everything else comes from the package root.
const SERVER = new Set([
  "@opencode/plugin", "@opencode/plugin/promise/tool", "@opencode/plugin/rpc",
  "node:fs", "node:fs/promises", "node:path", "node:os", "node:url", "node:crypto", "node:buffer",
])
const TUI = new Set(["@opencode/plugin", "@opencode/plugin/tui", "@opencode/plugin/rpc", "@opentui/core", "@opentui/solid", "solid-js", "solid-js/store"])

const policy: Policy = {
  external: (specifier, file) => (file.startsWith("tui/") ? TUI : SERVER).has(specifier),
  local: (destination, file) => {
    // The TUI is a separate part: it reaches the server only through the RPC contract.
    if (file.startsWith("tui/")) return destination.startsWith("tui/") || destination.startsWith("rpc/")
    // The atomic writer stays portable.
    if (file.startsWith("io/")) return destination.startsWith("io/")
    return !destination.startsWith("tui/")
  },
}

function violations(file: string, text: string): string[] {
  const errors = scanImports(file, text, tree, policy)
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteralLike(node) && /^https?:\/\//.test(node.text) && /(?:^|\.)granola\.ai$/.test(new URL(node.text).hostname)
      && node.text !== "https://mcp.granola.ai/mcp") errors.push(`${relative(tree, file)}: alternative Granola backend URL`)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return errors
}

const files = walk(tree).filter((file) => /\.tsx?$/.test(file))

describe("production architecture", () => {
  it("uses public SDK entrypoints and host-owned transport only", () => {
    expect(files.length).toBeGreaterThan(0)
    expect(files.flatMap((file) => violations(file, readFileSync(file, "utf8")))).toEqual([])
  })

  it("uses none of the fork-only or retired host APIs", () => {
    const forbidden = /mcp\.catalog|mcp\.attest|supports[A-Z]|responsePolicy|capabilities:|image:|options\.mcp|\.assert\([^;]*?,\s*\{\s*signal|generate\.text|experimental\.policies/
    for (const file of files) expect(readFileSync(file, "utf8"), relative(root, file)).not.toMatch(forbidden)
  })

  it("hooks permission evaluation only in the tools RPC, exactly once", () => {
    // It turns an ask on one of the RPC's own script calls in flight into a deny, because no one can answer it.
    const hooks = files.map((file) => [relative(root, file), readFileSync(file, "utf8").match(/hook\("evaluate"/g)?.length ?? 0] as const)
    expect(hooks.filter(([, count]) => count > 0)).toEqual([["src/host/tools-rpc.ts", 1]])
  })

  it("rejects bypasses rather than only today's source text", () => {
    const file = resolve(tree, "example.ts")
    for (const text of [
      'import { Client } from "@opencode/client"',
      'export * from "@opencode/core/permission"',
      'const api = import("@opencode/plugin/dist/internal.js")',
      'import { Schema } from "effect"',
      'import { z } from "zod"',
      'const shell = require("node:child_process")',
      'import { request } from "node:https"',
      'await globalThis.fetch("https://example.test")',
      'const request = fetch; request("https://example.test")',
      'const load = (name: string) => import(name)',
      'Bun.serve({ fetch: () => new Response() })',
      'const credential = "~/.local/share/opencode/mcp-auth.json"',
      'import "./tui/index.js"',
      'const url = "https://api.granola.ai/v1/notes"',
    ]) expect(violations(file, text), text).not.toEqual([])
    expect(violations(resolve(tree, "tui/view.tsx"), 'import { status } from "../status.js"')).not.toEqual([])
    expect(violations(resolve(tree, "io/writer.ts"), 'import { describe } from "../errors.js"')).not.toEqual([])
  })

  it("accepts the legal edges", () => {
    expect(violations(resolve(tree, "example.ts"), [
      'import { Plugin } from "@opencode/plugin"',
      'import { Error as ToolError } from "@opencode/plugin/promise/tool"',
      'import { readFileSync } from "node:fs"',
      'import { describe } from "./errors.js"',
      'const match = /a/.exec("a")',
      'const url = "https://mcp.granola.ai/mcp"',
    ].join("\n"))).toEqual([])
    expect(violations(resolve(tree, "tui/view.tsx"), 'import { createSignal } from "solid-js"\nimport { Granola } from "../rpc/contract.js"')).toEqual([])
  })
})
