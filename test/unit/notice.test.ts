// The release tarball ships NOTICE next to a bundle that inlines third-party code. Build the server entry with the
// same externals as scripts/build.mjs, collect the packages that actually end up in the bundle (including packages
// inlined inside plugin-contract's dist, such as zod), and require each package's verbatim licence in NOTICE.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const root = fileURLToPath(new URL("../../", import.meta.url))
const HOST = ["@opencode/*"]
const PLUGIN = "@we-the-rebel-alliance/granola-plugin"

/** A package name from an esbuild input path, or undefined for the plugin's own sources. */
function packageOf(path: string): string | undefined {
  return /^node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(path)?.[1]
}

function keep(name: string | undefined): name is string {
  return name !== undefined && name !== PLUGIN && !name.startsWith("@opencode/") && !name.startsWith(".")
}

/** Every package esbuild actually inlines into the server bundle. */
async function bundledPackages(): Promise<string[]> {
  const result = await build({
    absWorkingDir: root,
    entryPoints: ["src/index.ts"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "node24",
    external: HOST,
    legalComments: "none",
    metafile: true,
    logLevel: "silent",
  })
  const inputs = Object.keys(result.metafile.inputs)
  const found = new Set<string>()
  for (const path of inputs) {
    const name = packageOf(path)
    if (keep(name)) found.add(name)
  }
  // plugin-contract's dist inlines its own dependencies; the original module path survives in a comment.
  for (const path of inputs) {
    if (!path.startsWith("node_modules/")) continue
    const text = readFileSync(join(root, path), "utf8")
    for (const match of text.matchAll(/\/\/\s*node_modules\/((?:@[^/\s]+\/)?[^/\s]+)\//g)) {
      if (keep(match[1])) found.add(match[1])
    }
  }
  return [...found].sort()
}

interface Package { readonly name: string; readonly version: string; readonly license: string; readonly text: string }

function packageInfo(name: string): Package {
  const directory = join(root, "node_modules", name)
  const pkg = JSON.parse(readFileSync(join(directory, "package.json"), "utf8")) as { version: string; license?: string }
  return {
    name,
    version: pkg.version,
    license: pkg.license ?? "UNKNOWN",
    text: readFileSync(join(directory, "LICENSE"), "utf8").trimEnd(),
  }
}

function section(name: string, version: string, license: string): string {
  return `## ${name} ${version} (${license})`
}

function missingNoticeSections(notice: string, packages: readonly Package[]): string[] {
  return packages.filter((pkg) => !notice.includes(section(pkg.name, pkg.version, pkg.license)) || !notice.includes(pkg.text)).map((pkg) => pkg.name)
}

test("every bundled package has its verbatim licence in NOTICE", async () => {
  const names = await bundledPackages()
  assert.ok(names.includes("yaml"), "yaml is bundled")
  assert.ok(names.includes("@we-the-rebel-alliance/plugin-contract"), "plugin-contract is bundled")
  const packages = names.map(packageInfo)
  const notice = readFileSync(join(root, "NOTICE"), "utf8")
  assert.deepEqual(missingNoticeSections(notice, packages), [])
})

test("a missing package section is reported", () => {
  const notice = readFileSync(join(root, "NOTICE"), "utf8")
  const withoutZod = notice.replace(/^## zod[\s\S]*?(?=^## |\s*$)/m, "")
  assert.deepEqual(missingNoticeSections(withoutZod, [packageInfo("zod")]), ["zod"])
})
