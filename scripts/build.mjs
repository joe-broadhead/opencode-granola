#!/usr/bin/env node
// Bundles the two parts OpenCode loads into exactly two self-contained files: dist/index.js (server) and dist/tui.js
// (TUI). First-party code, including the RPC contract both parts use, is inlined into each, so neither imports a
// sibling file. OpenCode reloads a plugin in place and can keep an older copy of an unchanged sibling module, which a
// new entry would then import. The host provides @opencode/plugin, OpenTUI and Solid, so they stay bare imports; the
// build fails if an output imports anything else.
//
// OpenCode does not compile JSX from node_modules, so the TUI's .tsx files are compiled here: esbuild strips the
// types and keeps the JSX, then Solid's universal transform for @opentui/solid turns it into plain JavaScript.
import { transformAsync } from "@babel/core"
import { build, transform } from "esbuild"
import { readFileSync, rmSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const HOST = ["@opencode/plugin", "@opencode/plugin/*", "@opentui/*", "solid-js", "solid-js/*"]
const allowed = (path) => path.startsWith("node:") || HOST.some((name) => (name.endsWith("/*") ? path.startsWith(name.slice(0, -1)) : path === name))

/** Compiles .tsx with Solid's universal transform before esbuild bundles it. */
const solid = {
  name: "solid-universal",
  setup(plugin) {
    plugin.onLoad({ filter: /\.tsx$/ }, async ({ path }) => {
      const stripped = await transform(readFileSync(path, "utf8"), { loader: "tsx", jsx: "preserve", sourcefile: path, format: "esm" })
      const result = await transformAsync(stripped.code, {
        filename: path,
        configFile: false,
        babelrc: false,
        sourceMaps: false,
        presets: [["babel-preset-solid", { moduleName: "@opentui/solid", generate: "universal" }]],
      })
      if (!result?.code) throw new Error(`Babel produced no output for ${relative(ROOT, path)}`)
      return { contents: result.code, loader: "js" }
    })
  },
}

rmSync(join(ROOT, "dist"), { recursive: true, force: true })
const result = await build({
  absWorkingDir: ROOT,
  entryPoints: { index: "src/index.ts", tui: "src/tui/index.tsx" },
  outdir: "dist",
  bundle: true,
  splitting: false,
  format: "esm",
  platform: "node",
  target: "es2022",
  external: HOST,
  plugins: [solid],
  legalComments: "none",
  metafile: true,
  logLevel: "warning",
})

const outputs = Object.keys(result.metafile.outputs).map((file) => relative(ROOT, join(ROOT, file))).sort()
if (outputs.join() !== "dist/index.js,dist/tui.js") {
  console.error(`build: expected exactly dist/index.js and dist/tui.js, got ${outputs.join(", ")}`)
  process.exit(1)
}
const unexpected = Object.entries(result.metafile.outputs).flatMap(([file, output]) =>
  output.imports.filter((entry) => !allowed(entry.path)).map((entry) => `${file}: ${entry.path}`))
if (unexpected.length > 0) {
  console.error(`build: outputs import modules that are neither inlined nor provided by the host:\n  ${unexpected.join("\n  ")}`)
  process.exit(1)
}
for (const [file, output] of Object.entries(result.metafile.outputs)) {
  console.log(`built ${relative(ROOT, join(ROOT, file))} (${(output.bytes / 1024).toFixed(1)} KiB)`)
}
