#!/usr/bin/env node
// Parses the workflows as workflows, not as YAML: `actionlint` catches a `${{ }}` that only exists in some contexts,
// which makes GitHub reject the whole file and run nothing. CI runs it in its own job; here it runs when the tool is on
// PATH, and prints a notice when it is not, so a local check never skips silently.
import { spawnSync } from "node:child_process"
import { delimiter, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const env = { ...process.env, PATH: `${join(root, "node_modules", ".bin")}${delimiter}${process.env.PATH ?? ""}` }
const probe = spawnSync("actionlint", ["-version"], { encoding: "utf8", env })
if (probe.error?.code === "ENOENT") {
  console.log("actionlint is not on PATH, so the workflow check is skipped here; CI runs it in its own job.")
  process.exit(0)
}
const run = spawnSync("actionlint", ["-color"], { cwd: root, stdio: "inherit", env })
if (run.error) throw run.error
process.exit(run.status ?? 1)
