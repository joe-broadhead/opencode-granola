import { readFileSync, readdirSync } from "node:fs"
import { relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { describe, expect, it } from "vitest"

const root = fileURLToPath(new URL("../", import.meta.url))

/** Internal process and test vocabulary that must never reach the model. */
const BANNED = /\b(?:acceptance|fixtures?|(?:un)?verified|zero meetings|manifests?|digests?)\b/i
/** Plan, finding and verification references such as WS3, GRN-023, V14 and M0. */
const TRACKING = /\b(?:WS\d+|GRN-\d+|V\d{1,2}|M0)\b/

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(resolve(directory, entry.name)) : [resolve(directory, entry.name)])
}

function banned(text: string): string | undefined {
  return (BANNED.exec(text) ?? TRACKING.exec(text))?.[0]
}

const isModuleSpecifier = (node: ts.Node) => {
  const parent = node.parent
  return (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) && parent.moduleSpecifier === node
    || ts.isExternalModuleReference(parent)
    || ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent)
    || ts.isCallExpression(parent) && (parent.expression.kind === ts.SyntaxKind.ImportKeyword || parent.expression.getText() === "require")
}

/**
 * Text that can reach the model or the user: string and template literals and JSX text. Comments,
 * identifiers such as `.digest("hex")`, and import specifiers are code, not copy.
 */
function copy(file: string, source: string): { line: number; text: string }[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const found: { line: number; text: string }[] = []
  const visit = (node: ts.Node) => {
    const literal = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)
      || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)
    if (literal && !isModuleSpecifier(node)) {
      found.push({ line: tree.getLineAndCharacterOfPosition(node.getStart()).line + 1, text: node.text })
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return found
}

describe("model-visible copy", () => {
  it("skills carry no test status or internal jargon", () => {
    const files = walk(resolve(root, "skills"))
    expect(files.length).toBeGreaterThan(0)
    const hits = files.flatMap((file) => readFileSync(file, "utf8").split(/\r?\n/).flatMap((line, index) => {
      const term = banned(line)
      return term ? [`${relative(root, file)}:${index + 1}: ${term}`] : []
    }))
    expect(hits).toEqual([])
  })

  it("strings in src carry no test status or internal jargon", () => {
    // The shared events_list contract is carried unchanged; its conformance messages are for each source's tests.
    const shared = resolve(root, "src/host/events-list.ts")
    const files = walk(resolve(root, "src")).filter((file) => /\.tsx?$/.test(file) && file !== shared)
    expect(files.length).toBeGreaterThan(0)
    const hits = files.flatMap((file) => copy(file, readFileSync(file, "utf8")).flatMap(({ line, text }) => {
      const term = banned(text)
      return term ? [`${relative(root, file)}:${line}: ${term} in ${JSON.stringify(text)}`] : []
    }))
    expect(hits).toEqual([])
  })

  it("flags banned terms in every kind of copy", () => {
    const samples = [
      'const a = "Live acceptance passed"',
      "const b = `The ${kind} is unverified`",
      "const c = `${count} zero meetings`",
      'throw new Error("Catalog digest mismatch")',
      'const d = { description: "Reads the reviewed manifest" }',
      "const e = `Fixture ${name}`",
      'const f = "Recorded in WS3 under V14"',
      "const view = <text>GRN-023 is fixed</text>",
    ]
    for (const sample of samples) {
      const terms = copy("sample.tsx", sample).map(({ text }) => banned(text)).filter(Boolean)
      expect(terms, sample).not.toEqual([])
    }
  })

  it("ignores code identifiers, comments and import paths", () => {
    const source = [
      'import { manifest } from "./manifest.js"',
      'export type { Digest } from "./digest.js"',
      "// The acceptance fixture is verified elsewhere.",
      "/** Digest of the manifest. */",
      'const sha256 = createHash("sha256").update(data).digest("hex")',
      "const verified = manifest.digest",
      'const lazy = await import("./fixtures.js")',
      'const message = "Exported 2 meetings to notes.md"',
    ].join("\n")
    expect(copy("sample.ts", source).map(({ text }) => banned(text)).filter(Boolean)).toEqual([])
    expect(copy("sample.ts", source).map(({ text }) => text)).toEqual(["sha256", "hex", "Exported 2 meetings to notes.md"])
  })
})
