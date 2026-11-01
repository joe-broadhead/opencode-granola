import { dirname, relative, resolve } from "node:path"
import ts from "typescript"

export interface Policy {
  /** Whether a module in this production file may import the external specifier. */
  external(specifier: string, file: string): boolean
  /** Whether it may import the local module at this tree-relative path. */
  local(destination: string, file: string): boolean
}

// An import and capability regression gate, not a JavaScript sandbox. Literal module edges are checked
// whatever the binding name; computed loading is refused rather than guessed.
export function scanImports(file: string, text: string, tree: string, policy: Policy): string[] {
  const errors: string[] = []
  const local = relative(tree, file).replaceAll("\\", "/")
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const report = (message: string) => errors.push(`${local}: ${message}`)

  function dependency(specifier: string) {
    if (specifier.startsWith(".")) {
      const destination = relative(tree, resolve(dirname(file), specifier)).replaceAll("\\", "/")
      if (destination === ".." || destination.startsWith("../")) report(`import escapes the production tree: ${specifier}`)
      else if (!policy.local(destination, local)) report(`forbidden local dependency: ${specifier}`)
    } else if (!policy.external(specifier, local)) {
      report(`unreviewed dependency (private SDK, transport or wrong layer): ${specifier}`)
    }
  }

  const capabilities = new Set(["fetch", "WebSocket", "XMLHttpRequest", "Worker", "eval", "Function"])
  const globals = new Set(["globalThis", "global", "window", "self", "Bun"])
  const property = (node: ts.Node) => ts.isPropertyAccessExpression(node) ? node.name.text
    : ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : undefined

  function visit(node: ts.Node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      dependency(node.moduleSpecifier.text)
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) dependency(node.argument.literal.text)
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(source)
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword || name === "require" || property(node.expression) === "require") {
        const argument = node.arguments[0]
        if (argument && ts.isStringLiteralLike(argument)) dependency(argument.text)
        else report("computed module loading bypasses dependency review")
      }
      const regexExec = ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "exec"
        && node.expression.expression.kind === ts.SyntaxKind.RegularExpressionLiteral
      if (!regexExec && /(?:^|\.)(?:fetch|exec|execSync|execFile|execFileSync|spawn|spawnSync|fork|eval|Function)$/.test(name)) {
        report(`direct network, process or evaluation call: ${name}`)
      }
    }
    if (ts.isIdentifier(node) && capabilities.has(node.text) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) {
      report(`direct network or evaluation capability: ${node.text}`)
    }
    if ((ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) && globals.has(node.expression.getText(source))) {
      const name = property(node)
      if (name && (capabilities.has(name) || ["connect", "listen", "serve", "$", "spawn", "spawnSync", "file", "write"].includes(name))) {
        report(`direct network, process or filesystem capability: ${name}`)
      }
    }
    if (ts.isStringLiteralLike(node) && /(?:^|[/\\])(?:auth\.json|mcp-auth\.json|credentials\.json|supabase\.json|granola\.db|cache-v\d+\.json)$|Library[/\\]Application Support[/\\]Granola/i.test(node.text)) {
      report("desktop or host credential path")
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return errors
}
