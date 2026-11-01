#!/usr/bin/env node
// Fails on forbidden host APIs, private host source imports and bundled host runtime. It reads code, not text:
// comments, copy and the test suite's own sample strings never match. Model-visible wording is checked by
// test/ux.test.ts, and the src import boundaries by test/architecture.test.ts.
import { readFileSync, readdirSync } from "node:fs"
import { relative } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const root = fileURLToPath(new URL("../", import.meta.url))
const TESTED_HOST = ">=2.2.3 <2.3.0"
const SDK_VERSION = "2.2.3"

/** The first matching rule names the problem. Only @opencode/plugin, sdk, client and theme are public. */
const IMPORT_RULES = [
  [/(?:^|[\\/])packages[\\/][^\\/]+[\\/]src(?:[\\/]|$)/, "private host source (packages/*/src)"],
  [/^@opencode\/[^/]+\/(?:src|dist)(?:\/|$)/, "a path inside an @opencode package instead of its public exports"],
  [/^@opencode\/ai(?:\/|$)/, "@opencode/ai, which changes incompatibly between patch releases"],
  [/^@opencode\/(?!(?:plugin|sdk|client|theme)(?:\/|$))/, "a private host package"],
  [/^@opencode-ai\//, "the OpenCode V1 plugin API"],
  [/^(?:\/|[A-Za-z]:[\\/]|file:)/, "an absolute, machine-local module path"],
]
/** Only src/ ships. effect is not provided to plugins, so importing it means bundling it. */
const SHIPPED_IMPORT_RULES = [[/^effect(?:\/|$)/, "effect, which the host does not provide to plugins"]]

const LIFECYCLE = ["preinstall", "install", "postinstall", "prepare", "prepack", "postpack"]
const UNDECLARED = ["dependencies", "optionalDependencies", "bundleDependencies", "bundledDependencies", "peerDependencies", "peerDependenciesMeta"]

const problems = []
const report = (file, node, message) => {
  const { line } = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart())
  problems.push(`${relative(root, file)}:${line + 1}: ${message}`)
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(path)
    return /\.(?:[cm]?[jt]s|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [path] : []
  })
}

/** `a.b.c` as text for a property chain, ignoring optional chaining; undefined for anything else. */
function chain(node) {
  if (ts.isIdentifier(node)) return node.text
  if (node.kind === ts.SyntaxKind.ThisKeyword) return "this"
  if (ts.isPropertyAccessExpression(node)) {
    const head = chain(node.expression)
    return head === undefined ? undefined : `${head}.${node.name.text}`
  }
  if (ts.isNonNullExpression(node) || ts.isParenthesizedExpression(node)) return chain(node.expression)
  return undefined
}

const endsWith = (text, suffix) => text === suffix || text?.endsWith(`.${suffix}`)
const propertyName = (node) => (node.name && (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)) ? node.name.text : undefined)

/**
 * The fork-only, deprecated and experimental host APIs. Each returns a message for a node, or nothing. The config
 * key `capabilities` is checked in src/ only: tests also speak MCP, whose initialize reply has a field of that name.
 */
const API_RULES = [
  (node) => ts.isPropertyAccessExpression(node) && ["catalog", "attest"].includes(node.name.text) && endsWith(chain(node.expression), "mcp")
    && `ctx.mcp.${node.name.text} exists only in the retired host fork`,
  (node) => ts.isIdentifier(node) && /^supports[A-Z]/.test(node.text) && `${node.text}: support markers belong to the retired host fork`,
  (node) => ts.isPropertyAccessExpression(node) && node.name.text === "text" && endsWith(chain(node.expression), "generate")
    && "ctx.generate.text is deprecated",
  (node) => ts.isPropertyAccessExpression(node) && ["policies", "artifact"].includes(node.name.text) && endsWith(chain(node.expression), "experimental")
    && `experimental.${node.name.text} is ${node.name.text === "policies" ? "deprecated" : "experimental"}; do not use it`,
  (node) => ts.isPropertyAccessExpression(node) && node.name.text === "mcp" && endsWith(chain(node.expression), "options")
    && "tool options.mcp delegation belongs to the retired host fork",
  (node) => ts.isPropertyAccessExpression(node) && node.name.text === "evaluate" && endsWith(chain(node.expression), "permission")
    && "a permission evaluate hook; insert default rules with ctx.agent.transform instead",
  (node) => ts.isCallExpression(node) && endsWith(chain(node.expression), "hook") && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])
    && /evaluate/.test(node.arguments[0].text) && "a permission evaluate hook; insert default rules with ctx.agent.transform instead",
  (node) => ts.isCallExpression(node) && endsWith(chain(node.expression), "permission.assert") && node.arguments.length !== 1
    && "call ctx.permission.assert(input) with the input only: no signal or other options",
  (node, shipped) => (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node) || ts.isMethodDeclaration(node))
    && (shipped ? ["capabilities", "responsePolicy"] : ["responsePolicy"]).includes(propertyName(node))
    && `config ${propertyName(node)} belongs to the retired host fork`,
  (node) => ts.isCallExpression(node) && endsWith(chain(node.expression), "Plugin.define") && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])
    && node.arguments[0].properties.some((property) => propertyName(property) === "image") && "Plugin.image is dropped: plugins carry no profile image",
  (node, shipped) => shipped && ts.isPropertyAccessExpression(node) && node.name.text === "slot" && endsWith(chain(node.expression), "ui")
    && "ui.slot: nothing is always visible; status lives in the /granola dialog",
]

function scan(file, { shipped }) {
  const text = readFileSync(file, "utf8")
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind)
  const rules = shipped ? [...IMPORT_RULES, ...SHIPPED_IMPORT_RULES] : IMPORT_RULES

  const specifier = (node, value) => {
    const rule = rules.find(([pattern]) => pattern.test(value))
    if (rule) report(file, node, `imports ${value}: ${rule[1]}`)
  }
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      specifier(node.moduleSpecifier, node.moduleSpecifier.text)
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) {
      specifier(node.argument.literal, node.argument.literal.text)
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || endsWith(chain(node.expression), "require"))
      && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
      specifier(node.arguments[0], node.arguments[0].text)
    }
    for (const rule of API_RULES) {
      const message = rule(node, shipped)
      if (message) report(file, node, message)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}

function checkManifest() {
  const file = `${root}package.json`
  const pkg = JSON.parse(readFileSync(file, "utf8"))
  const fail = (message) => problems.push(`package.json: ${message}`)
  for (const field of UNDECLARED) {
    if (pkg[field] !== undefined) fail(`declares ${field}; the package ships JavaScript only and OpenCode provides @opencode/plugin, OpenTUI and Solid`)
  }
  for (const name of LIFECYCLE) if (pkg.scripts?.[name] !== undefined) fail(`has a ${name} script; OpenCode installs plugins with scripts off, so ship a built dist/`)
  if (pkg.devDependencies?.["@opencode/plugin"] !== SDK_VERSION) fail(`@opencode/plugin must be a devDependency pinned to exactly ${SDK_VERSION}`)
  if (pkg.opencode?.host !== TESTED_HOST) fail(`opencode.host must be exactly "${TESTED_HOST}"`)
}

const shipped = walk(`${root}src`)
const tooling = ["test", "scripts"].flatMap((directory) => walk(`${root}${directory}`))
for (const file of shipped) scan(file, { shipped: true })
for (const file of tooling) scan(file, { shipped: false })
checkManifest()

if (problems.length > 0) {
  console.error(`check-forbidden: ${problems.length} problem${problems.length === 1 ? "" : "s"}`)
  for (const problem of problems) console.error(`  ${problem}`)
  process.exit(1)
}
console.log(`check-forbidden: ${shipped.length + tooling.length} files and package.json are clean`)
