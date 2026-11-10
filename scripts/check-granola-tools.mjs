// Maintainer-run drift check against a saved copy of Granola's tool list. It warns; nothing at runtime depends on it.
//
//   npm run drift -- <tools.json> [--strict]
//
// <tools.json> is a saved tool list, in either form: OpenCode's tool list (`{ "tools": [{ "name", … }] }`, names with or
// without the `granola_` prefix), or an MCP client's `tools/list` result, which adds `annotations`. The script reads that
// file only: it never reads a credential and never calls Granola. It compares the names with READ_TOOLS and WRITE_TOOLS
// in src/known-tools.ts, and prints only tool names and Granola's readOnlyHint and destructiveHint annotations.
// Exit codes: 0 no drift, or drift without --strict; 1 drift with --strict; 2 usage or file error.
// Needs Node 22.18 or later, which loads the TypeScript file by stripping its types.
import { readFileSync } from "node:fs"

const USAGE = "Usage: npm run drift -- <tools.json> [--strict]"
const PREFIX = "granola_"

const fail = (message) => {
  console.error(message)
  process.exit(2)
}

let strict = false
let file
for (const arg of process.argv.slice(2)) {
  if (arg === "--strict") strict = true
  else if (!arg.startsWith("--") && file === undefined) file = arg
  else fail(`unknown argument "${arg}". ${USAGE}`)
}
if (file === undefined) fail(`no tool list given. ${USAGE}`)
if (!process.features.typescript) fail(`Node ${process.versions.node} cannot load TypeScript files. Use Node 22.18 or later.`)

/** The saved list: name → annotations, with the prefix removed. */
function readToolList(path) {
  let data
  try {
    data = JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    fail(`${path}: cannot read a JSON tool list (${error instanceof Error ? error.message : String(error)}).`)
  }
  if (!data || !Array.isArray(data.tools)) fail(`${path}: expected { "tools": [...] }.`)
  const tools = new Map()
  for (const tool of data.tools) {
    if (typeof tool?.name !== "string") fail(`${path}: a tool has no name.`)
    tools.set(tool.name.startsWith(PREFIX) ? tool.name.slice(PREFIX.length) : tool.name, tool.annotations ?? {})
  }
  return tools
}

const known = await import("../src/known-tools.ts")
const reads = new Set(known.READ_TOOLS)
const writes = new Set(known.WRITE_TOOLS)
const hidden = new Set(known.HIDDEN_TOOLS)
const own = new Set([...known.PLUGIN_TOOLS, ...known.PLUGIN_READS])
const live = readToolList(file)

const added = [...live.keys()].filter((name) => !reads.has(name) && !writes.has(name) && !hidden.has(name) && !own.has(name)).sort()
const removed = [...reads, ...writes].filter((name) => !live.has(name)).sort()
const reclassified = [...live]
  .filter(([name, hints]) => (reads.has(name) && (hints.readOnlyHint === false || hints.destructiveHint === true)) || (writes.has(name) && hints.readOnlyHint === true))
  .map(([name]) => name)
  .sort()

const drift = added.length + removed.length + reclassified.length
if (drift === 0) {
  console.log(`no drift: ${live.size} tools match READ_TOOLS and WRITE_TOOLS.`)
} else {
  if (added.length) console.log(`added, unclassified (${added.length}): ${added.join(", ")}`)
  if (removed.length) console.log(`removed (${removed.length}): ${removed.join(", ")}`)
  if (reclassified.length) console.log(`annotations disagree with the class (${reclassified.length}): ${reclassified.join(", ")}`)
}
process.exit(drift > 0 && strict ? 1 : 0)
