/**
 * The plugin's one entry: `Plugin.define({ id, setup })`, the host gate, the accounts, the bundled skills, and one
 * `register` call.
 *
 * `register` wires doors 1–3 from `handlers`, resolves accounts and generates the access rules. This file never calls
 * `ctx.tool`, `ctx.rpc` or `ctx.permission` itself. Skills are registered here because the contract's `register` does
 * not register them.
 */
import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import { Plugin } from "@opencode/plugin"
import { accountsOf } from "@we-the-rebel-alliance/plugin-contract/accounts"
import { assertHost, register } from "@we-the-rebel-alliance/plugin-contract/register"
import { registerMcpAccounts } from "./accounts.ts"
import { handlersFor } from "./handlers/index.ts"
import { manifest, packageName, version } from "./manifest.ts"
import { createProvider } from "./provider/client.ts"
import { readSkills, registerSkills } from "./skills.ts"

/** The export folder: `exportDirectory` when given, else `~/Granola`. A leading `~` is the home folder. */
export function exportDirectoryOf(options: Readonly<Record<string, unknown>>): string {
  const raw = options["exportDirectory"]
  if (raw === undefined) return join(homedir(), "Granola")
  if (typeof raw !== "string" || raw.includes("\0")) {
    throw new Error("OPTIONS_INVALID: exportDirectory must be an absolute path or start with ~/. Next step: set an absolute folder, or ~/Granola.")
  }
  const expanded = raw === "~" ? homedir() : raw.startsWith("~/") ? join(homedir(), raw.slice(2)) : raw
  if (!isAbsolute(expanded)) {
    throw new Error("OPTIONS_INVALID: exportDirectory must be an absolute path or start with ~/. Next step: set an absolute folder, or ~/Granola.")
  }
  return resolve(expanded)
}

export default Plugin.define({
  id: manifest.plugin.name,
  async setup(context) {
    assertHost(context, manifest)

    const options = (context.options ?? {}) as Readonly<Record<string, unknown>>
    const plan = accountsOf(manifest, options)
    if (!plan.ok) {
      throw new Error(`OPTIONS_INVALID: ${plan.problems.join("; ")}. Next step: fix the plugin's accounts option.`)
    }

    const exportDirectory = exportDirectoryOf(options)
    // Read before the synchronous transform, and before any door is wired: a broken skill fails setup cleanly.
    const skills = readSkills()

    // The vendor's MCP server holds the credentials: one server per alias, named <plugin> or <plugin>-<alias>.
    const accountRegistration = await registerMcpAccounts(context, manifest, options)
    const provider = createProvider({ tool: context.tool, mcp: context.mcp }, manifest.plugin.name)

    const handlers = handlersFor({
      manifest,
      packageName,
      version,
      hostVersion: context.app.version,
      accounts: plan.value.accounts,
      accountProblems: accountRegistration.problems,
      exportDirectory,
      provider,
      clock: Date.now,
    })

    await registerSkills(context.skill, skills)
    const registration = await register(context, manifest, handlers)
    return () => registration.dispose()
  },
})
