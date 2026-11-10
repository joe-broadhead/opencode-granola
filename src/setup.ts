import type { Plugin } from "@opencode/plugin"
import { registerCommands, type CommandsContext } from "./commands.js"
import { eventsMethod, registerEvents } from "./events/index.js"
import { registerExport, type ExportContext } from "./export/index.js"
import { checkHost } from "./host-check.js"
import { METHODS, exportMethod, type ToolsRpcOptions } from "./host/tools-rpc.js"
import { registerIntegration, type IntegrationContext } from "./integration.js"
import { SERVER } from "./known-tools.js"
import { readPackageInfo } from "./meta.js"
import { parseOptions } from "./options.js"
import { registerPermissions } from "./permissions.js"
import { registerRpc } from "./rpc/register.js"
import { registerServer } from "./server.js"
import { readSkills, registerSkills } from "./skills.js"
import { createStatus, type StatusContext } from "./status.js"
import { registerTools, type ToolsContext, type ToolsState } from "./tools.js"

/** The parts of OpenCode's plugin context that setup uses, and nothing more. */
export type SetupContext = {
  readonly app: Pick<Plugin.Context["app"], "version">
  readonly options: Plugin.Context["options"]
  readonly mcp: Pick<Plugin.Context["mcp"], "transform" | "list">
  readonly agent: Pick<Plugin.Context["agent"], "transform" | "list">
  readonly tool: Pick<Plugin.Context["tool"], "transform" | "list" | "hook">
  readonly skill: Pick<Plugin.Context["skill"], "transform" | "list">
  readonly rpc: Pick<Plugin.Context["rpc"], "register">
} & IntegrationContext & StatusContext & ToolsContext & CommandsContext & ExportContext

/**
 * Registers the tools RPC, `granola.meetings.tools`, and returns its cleanup. It needs more of the plugin context than
 * setup's, so index.ts binds it to the real context.
 */
export type ToolsRpc = (options: ToolsRpcOptions) => Promise<() => Promise<void>>

export async function setup(ctx: SetupContext, toolsRpc: ToolsRpc): Promise<() => Promise<void>> {
  const info = readPackageInfo()
  const options = parseOptions(ctx.options)
  const host = checkHost(ctx.app.version, info.hostRange, options.allowUntestedHost)
  const skills = readSkills()

  const server = await registerServer(ctx)
  const integration = await registerIntegration(ctx, server.conflict)
  await registerPermissions(ctx, options.access)
  let tools: ToolsState | undefined
  const status = createStatus(ctx, () => ({
    hidden: tools?.hidden() ?? 0,
    workspace: tools?.workspace(),
    conflict: server.conflict(),
    exportDirectory: options.exportDirectory,
    access: options.access,
    version: info.version,
    host,
    bundledSkills: skills.map(({ name, path }) => ({ name, path })),
  }))
  tools = await registerTools(ctx, options.exportDirectory)
  await registerCommands(ctx, status)
  await registerSkills(ctx, skills)
  await registerExport(ctx, options)
  await registerEvents(ctx)
  await registerRpc(ctx, status)
  // Scripts call every Granola tool with no model, as a session and its agent; a user's own granola server is not ours.
  // events_list is the plugin's own read, for Memory's collector: it reads through the same Granola tools.
  const stopTools = await toolsRpc({
    methods: [...METHODS, exportMethod(ctx as never, options.exportDirectory), eventsMethod(ctx)],
    mcp: { server: SERVER, managed: () => server.conflict() === undefined },
  })
  return async () => {
    tools?.dispose()
    await stopTools()
    await integration.dispose()
  }
}
