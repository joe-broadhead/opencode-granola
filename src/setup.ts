import type { Plugin } from "@opencode/plugin"
import { registerCommands, type CommandsContext } from "./commands.js"
import { registerExport, type ExportContext } from "./export/index.js"
import { checkHost } from "./host-check.js"
import { registerIntegration, type IntegrationContext } from "./integration.js"
import { readPackageInfo } from "./meta.js"
import { parseOptions } from "./options.js"
import { registerPermissions } from "./permissions.js"
import { registerRpc } from "./rpc/register.js"
import { registerServer } from "./server.js"
import { registerSkills } from "./skills.js"
import { createStatus, type StatusContext } from "./status.js"
import { registerTools, type ToolsContext, type ToolsState } from "./tools.js"

/** The parts of OpenCode's plugin context that setup uses, and nothing more. */
export type SetupContext = {
  readonly app: Pick<Plugin.Context["app"], "version">
  readonly options: Plugin.Context["options"]
  readonly mcp: Pick<Plugin.Context["mcp"], "transform" | "list">
  readonly agent: Pick<Plugin.Context["agent"], "transform" | "list">
  readonly tool: Pick<Plugin.Context["tool"], "transform" | "list" | "hook">
  readonly skill: Pick<Plugin.Context["skill"], "transform">
  readonly rpc: Pick<Plugin.Context["rpc"], "register">
} & IntegrationContext & StatusContext & ToolsContext & CommandsContext & ExportContext

export async function setup(ctx: SetupContext): Promise<() => Promise<void>> {
  const info = readPackageInfo()
  const options = parseOptions(ctx.options)
  const host = checkHost(ctx.app.version, info.testedHost, options.allowUntestedHost)

  const server = await registerServer(ctx)
  const integration = await registerIntegration(ctx, server.conflict)
  await registerPermissions(ctx)
  let tools: ToolsState | undefined
  const status = createStatus(ctx, () => ({
    hidden: tools?.hidden() ?? 0,
    workspace: tools?.workspace(),
    conflict: server.conflict(),
    exportDirectory: options.exportDirectory,
    pluginVersion: info.version,
    host,
  }))
  tools = await registerTools(ctx)
  await registerCommands(ctx, status)
  await registerSkills(ctx)
  await registerExport(ctx, options)
  await registerRpc(ctx, status)
  return () => integration.dispose()
}
