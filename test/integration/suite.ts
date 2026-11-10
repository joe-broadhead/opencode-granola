// The host test, run against every host in embedded.test.ts and binary.test.ts. It checks what the plugin
// registers on a real OpenCode host and how OpenCode then runs Granola's tools and the plugin's own: the default
// permission rules and their precedence, status in every connection state, the export, the tools RPC for scripts, and
// unloading.
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { afterAll, beforeAll, describe, expect, test } from "vitest"
import { connectionProblem, toolUnavailable } from "../../src/errors.js"
import { SIGN_IN_MESSAGE } from "../../src/integration.js"
import { METHODS, TOOLS_RPC_ID } from "../../src/host/tools-rpc.js"
import { defaultRules, type Rule } from "../../src/permissions.js"
import { Granola, type Status } from "../../src/rpc/contract.js"
import { AGENT_FIX, CONFLICT_NEXT, formatStatus, shadowedFix } from "../../src/status.js"
import { EMAIL, FAILING, MEETING, MEETING_AT, PLAN_LIMITED, TITLE, TOOLS, UPSTREAM_FAILURE, WORKSPACE, type SyntheticGranola } from "../synthetic-granola/server.js"
import { ADOPTED_SERVER, globalPaths, OFFICIAL_URL, OTHER_SERVER, repositoryChanges, REPO, SHADOWING_SKILL, type Host, type Project } from "./harness.js"
import type { CallInput, CallResult, Outcome, ProbeState } from "./probe/index.js"

const VERSION = (JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as { version: string }).version
const SKILLS = ["granola", "granola-meeting-brief"]
/** Agents defined only in the main project's config; OpenCode creates them after package plugins run. */
const CONFIG_ONLY = ["reviewer", "fixed", "locked", "careful"]

const isBaseAllow = (rule: Rule) => rule.action === "*" && rule.resource === "*" && rule.effect === "allow"
const blocks = (permissions: readonly Rule[]) => permissions.filter((rule) => rule.action === "granola_*" && rule.effect !== "deny").length
const granolaRules = (permissions: readonly Rule[]) => permissions.filter((rule) => rule.action.startsWith("granola"))
const id = (name: string) => `granola_${name}`
/** OpenCode has registered the server and finished its first connection attempt. */
const settled = (current: Status) => current.state !== "connecting" && current.state !== "not_configured"
/** Connected, with Granola's tools in the registry: OpenCode can report connected before it lists them. */
const connected = (current: Status) => current.state === "connected" && current.tools.visible > 0

export function hostSuite(name: string, start: (fake: SyntheticGranola) => Promise<Host>, fake: () => SyntheticGranola, budget?: (host: Host) => Promise<void>): void {
  describe(name, () => {
    let host: Host
    let changesBefore: string

    beforeAll(async () => {
      changesBefore = repositoryChanges()
      host = await start(fake())
    }, 300_000)
    afterAll(async () => {
      await host?.close()
    }, 60_000)

    if (budget) test("the forced Granola catalogue stays under 1,000 tokens", () => budget(host), 120_000)

    const at = (project: Project) => ({ location: host.location(project) })
    /** For calls whose input names no location: OpenCode then takes it from this header. */
    const header = (project: Project) => ({ headers: { "x-opencode-directory": encodeURIComponent(host.location(project).directory) } })
    const probe = async <T>(method: string, project: Project, input: object = {}) =>
      (await host.client.rpc.call({ rpcID: "granola.test.probe", method, input: input as never, ...at(project) })).output as T
    const state = (project: Project) => probe<ProbeState>("state", project)
    const run = (project: Project, input: CallInput) => probe<CallResult>("call", project, input)
    const check = (project: Project, agent: string, action: string, resource?: string) => probe<Outcome>("check", project, { agent, action, resource })
    const status = (project: Project) => host.client.rpc(Granola).status({}, at(project)) as Promise<Status>
    /** Tools the synthetic server received from now on. */
    const received = () => {
      const from = fake().calls.length
      return () => fake().calls.slice(from).map((call) => call.tool)
    }

    /** granola.meetings once its activation has finished; listing plugins does not wait for it. */
    async function activated(project: Project) {
      for (const deadline = Date.now() + 60_000; ; await sleep(250)) {
        const plugin = (await host.client.plugin.list(at(project))).data.find((entry) => entry.id === "granola.meetings")
        if (plugin?.state.status === "active" || plugin?.state.status === "failed" || Date.now() > deadline) return plugin
      }
    }

    /** Polls status until `done`; plugins activate and servers connect after the host answers. */
    async function statusWhen(project: Project, done: (current: Status) => boolean): Promise<Status> {
      for (const deadline = Date.now() + 60_000; ; await sleep(250)) {
        const current = await status(project)
        if (done(current) || Date.now() > deadline) return current
      }
    }

    /**
     * Runs `code` as Code Mode does, through a schedule's check program: OpenCode checks each tool's input and output
     * and evaluates permissions with nobody present to answer. The program reports by throwing "SEEN <json>", so no
     * schedule is ever created.
     */
    async function codeMode(project: Project, code: string): Promise<{ seen: unknown } | { refused: string }> {
      const session = await host.client.session.create({ title: "Granola Code Mode check", agent: "build", ...at(project) })
      let message: string
      try {
        const schedule = await host.client.experimental.schedule.create({ sessionID: session.id, name: "granola-host-test", when: { in: "6 hours" }, prompt: "noop", if: { code } })
        await host.client.experimental.schedule.delete({ scheduleID: schedule.id })
        throw new Error("the check program finished without reporting")
      } catch (error) {
        message = error instanceof Error ? error.message : String(error)
      }
      const seen = /SEEN (.*)$/s.exec(message)
      return seen ? { seen: JSON.parse(seen[1]!) } : { refused: message }
    }

    async function slashStatus(project: Project): Promise<string> {
      const session = await host.client.session.create({ title: "Granola status", ...at(project) })
      await host.client.session.command({ sessionID: session.id, name: "granola-status", text: "" })
      for (const deadline = Date.now() + 20_000; Date.now() < deadline; await sleep(100)) {
        const posted = (await host.client.session.inbox.list({ sessionID: session.id })).find((item) => item.type === "synthetic")
        if (posted?.type === "synthetic") return posted.payload.text
      }
      throw new Error("/granola-status posted nothing")
    }

    test("OpenCode's home, tmp and global folders resolve inside the temp root", async () => {
      expect(await globalPaths(host.client, host.location("main"))).toEqual({ home: join(host.root, "home"), tmp: join(host.root, "tmp", "opencode") })
      const folders = [host.config, join("home", ".local", "share", "opencode"), join("home", ".local", "state", "opencode"), join("home", ".cache", "opencode")]
      for (const folder of folders) expect({ folder, exists: existsSync(join(host.root, folder)) }).toEqual({ folder, exists: true })
    })

    describe("activation and registration", () => {
      test("granola.meetings is active with its server and TUI parts, and exports no ./rpc entry", async () => {
        const plugin = await activated("main")
        expect(plugin).toMatchObject({ state: { status: "active" }, features: { server: true, tui: true } })
        expect(plugin?.features).not.toHaveProperty("rpc")
      })

      test("registers Granola's official server under the name granola, and OpenCode connects to it", async () => {
        expect((await state("main")).registered).toStrictEqual({ type: "remote", url: OFFICIAL_URL })
        await statusWhen("main", connected)
        const server = (await host.client.mcp.list(at("main"))).data.find((entry) => entry.name === "granola")
        expect(server).toMatchObject({ status: { status: "connected" }, title: TITLE })
      })

      test("/connect lists the server's sign-in as Granola", async () => {
        await statusWhen("needs-auth", settled)
        const integrationID = (await host.client.mcp.list(at("needs-auth"))).data.find((entry) => entry.name === "granola")?.integrationID
        expect(integrationID).toBeDefined()
        // /connect builds its list from integration.list.
        let listed: { name: string; metadata?: Record<string, unknown> } | undefined
        for (const deadline = Date.now() + 20_000; Date.now() < deadline && listed?.name !== "Granola"; await sleep(250)) {
          listed = (await host.client.integration.list(at("needs-auth"))).data.find((entry) => entry.id === integrationID)
        }
        expect(listed).toMatchObject({ name: "Granola", metadata: { source: "mcp" } })
      })

      test("adopts the user's own granola entry for the official URL as it is", async () => {
        expect((await state("adopted")).registered).toMatchObject(ADOPTED_SERVER)
        const current = await statusWhen("adopted", settled)
        expect(current.state).toBe("connected")
        expect(Object.hasOwn(current, "conflict")).toBe(false)
      })

      test("leaves the user's granola entry for another server alone, and status reports the conflict", async () => {
        expect((await state("conflict")).registered).toMatchObject(OTHER_SERVER)
        const current = await status("conflict")
        expect(current).toMatchObject({ state: "conflict", nextStep: CONFLICT_NEXT })
        expect(current.conflict).toEqual(expect.any(String))
        expect(Object.hasOwn(current, "problem")).toBe(false)
      })

      test("an unsupported option fails activation with OPTIONS_INVALID, and nothing is registered", async () => {
        const plugin = await activated("invalid")
        expect(plugin?.state).toMatchObject({ status: "failed", error: expect.stringContaining("OPTIONS_INVALID") })
        const { registered, agents, tools } = await state("invalid")
        expect(registered).toBeNull()
        expect(tools).toEqual([])
        expect(agents.flatMap((agent) => granolaRules(agent.permissions))).toEqual([])
        expect((await host.client.skill.list(at("invalid"))).data.map((skill) => skill.id)).not.toContain("granola")
        await expect(status("invalid")).rejects.toThrow()
      })

      test("allowUntestedHost changes nothing on a tested OpenCode version", async () => {
        const current = await statusWhen("untested", settled)
        expect(current).toMatchObject({ state: "connected", host: { version: host.version, range: ">=2.2.3 <2.3.0", tested: true } })
        expect(Object.hasOwn(current, "hostWarning")).toBe(false)
      })

      test("registers the granola and granola-meeting-brief skills", async () => {
        const ids = (await host.client.skill.list(at("main"))).data.map((skill) => skill.id)
        expect(ids.filter((skill) => skill.startsWith("granola")).sort()).toEqual(SKILLS)
      })

      test("a project skill with the id granola takes the place of the plugin's, and status names it with the fix", async () => {
        const path = join(host.location("adopted").directory, SHADOWING_SKILL)
        const listed = (await host.client.skill.list(at("adopted"))).data.filter((skill) => skill.id === "granola")
        expect(listed.map((skill) => skill.path)).toEqual([path])
        const current = await statusWhen("adopted", connected)
        expect(current.shadowedSkills).toEqual([{ name: "granola", path }])
        expect(current.nextStep).toBe(shadowedFix(current.shadowedSkills))
        expect((await status("main")).shadowedSkills).toEqual([])
      })

      test("Granola's tools sit in the granola namespace next to the plugin's export and events_list; sign_out is removed", async () => {
        const { tools } = await state("main")
        const expected = [...TOOLS.read, ...TOOLS.write, ...TOOLS.unknown, "export_markdown", "events_list"].map(id).sort()
        expect(tools.map((tool) => tool.id).sort()).toEqual(expected)
        expect(tools.every((tool) => tool.namespace === "granola")).toBe(true)
        expect(tools.filter((tool) => tool.pinned)).toEqual([])
      })
    })

    describe("default permission rules", () => {
      test("each agent with a base allow gets the block directly after it, once; agents without one are left alone", async () => {
        const { agents } = await state("main")
        expect(agents.map((agent) => agent.id)).toEqual(expect.arrayContaining(["build", "plan", "general", "explore", ...CONFIG_ONLY]))
        for (const agent of agents.filter((entry) => !CONFIG_ONLY.includes(entry.id))) {
          const base = agent.permissions.findIndex(isBaseAllow)
          const rules = base === -1 ? [] : agent.permissions.slice(base + 1, base + 1 + defaultRules().length)
          expect({ agent: agent.id, rules, blocks: blocks(agent.permissions) }).toEqual({ agent: agent.id, rules: base === -1 ? [] : defaultRules(), blocks: base === -1 ? 0 : 1 })
        }
      })

      test("the block is the only change: without it, every agent's rules equal a host where the plugin did not load", async () => {
        // The needs-auth and invalid projects have the same user config; only invalid's plugin failed to activate.
        const loaded = (await state("needs-auth")).agents
        const bare = (await state("invalid")).agents
        expect(loaded.map((agent) => agent.id).sort()).toEqual(bare.map((agent) => agent.id).sort())
        for (const agent of loaded) {
          const permissions = [...agent.permissions]
          const base = permissions.findIndex(isBaseAllow)
          if (base !== -1) permissions.splice(base + 1, defaultRules().length)
          expect({ agent: agent.id, permissions }).toEqual({ agent: agent.id, permissions: bare.find((entry) => entry.id === agent.id)!.permissions })
        }
      })

      test("after the agents reload, the block still appears exactly once", async () => {
        const count = (current: ProbeState) => current.agents.map((agent) => [agent.id, blocks(agent.permissions)])
        const before = count(await state("main"))
        expect(count(await probe<ProbeState>("reload", "main"))).toEqual(before)
      })
    })

    describe("permissions", () => {
      test("a known read runs without asking", async () => {
        const calls = received()
        const result = await run("main", { agent: "build", tool: id("get_meetings"), input: { meeting_ids: [MEETING] } })
        expect(result).toMatchObject({ asked: [], output: expect.stringContaining(`id="${MEETING}"`) })
        expect(calls()).toEqual(["get_meetings"])
      })

      test.each(["update_folder", "brand_new_tool"])("%s runs without asking: every tool is allowed by default", async (tool) => {
        const calls = received()
        expect(await run("main", { agent: "build", tool: id(tool) })).toMatchObject({ asked: [] })
        expect(calls()).toEqual([tool])
        expect(await check("main", "build", id(tool))).toEqual({ outcome: "allow" })
      })

      test("an agent's own ask rule, later than the block, makes one call ask", async () => {
        const calls = received()
        const result = await run("main", { agent: "careful", tool: id("get_meetings"), input: { meeting_ids: [MEETING] }, replies: ["reject"] })
        expect(result).toMatchObject({ asked: [{ action: id("get_meetings"), resources: ["*"], save: ["*"] }], error: { tag: "Permission.DeclinedError" } })
        expect(calls()).toEqual([])
        // Its other tools still run.
        expect(await run("main", { agent: "careful", tool: id("update_folder"), input: { folder_id: "f-1" } })).toMatchObject({ asked: [] })
        expect(calls()).toEqual(["update_folder"])
      })

      test("the user's allow rule keeps a write running without a prompt", async () => {
        const calls = received()
        expect(await run("main", { agent: "build", tool: id("create_folder"), input: { title: "Notes" } })).toMatchObject({ asked: [], output: expect.anything() })
        expect(calls()).toEqual(["create_folder"])
      })

      test("the user's deny rule wins, without asking, and a deny also hides the tool", async () => {
        const calls = received()
        expect(await run("main", { agent: "build", tool: id("remove_note_from_folder") })).toMatchObject({ asked: [], error: { tag: "Permission.BlockedError" } })
        // general's own rules deny every Granola tool, reads included.
        expect(await run("main", { agent: "general", tool: id("get_meetings"), input: { meeting_ids: [MEETING] } })).toMatchObject({ asked: [], error: { tag: "Permission.BlockedError" } })
        expect(calls()).toEqual([])
      })

      test("an agent that asks for everything, reads included", async () => {
        const calls = received()
        expect(await run("main", { agent: "locked", tool: id("get_meetings"), input: { meeting_ids: [MEETING] } })).toMatchObject({ asked: [], error: { tag: "Permission.BlockedError" } })
        expect(calls()).toEqual([])
      })

      test("Plan is not weakened: its own edit rule still denies and Granola runs as the block allows", async () => {
        expect(await run("main", { agent: "plan", tool: id("get_meetings"), input: { meeting_ids: [MEETING] } })).toMatchObject({ asked: [] })
        expect(await run("main", { agent: "plan", tool: id("update_folder"), input: { folder_id: "f-1" } })).toMatchObject({ asked: [] })
        expect(await check("main", "plan", "edit", join(host.location("main").directory, "notes.md"))).toEqual({ outcome: "deny" })
      })

      test("Explore still denies Granola's tools", async () => {
        const calls = received()
        for (const tool of ["get_meetings", "update_folder", "brand_new_tool"]) {
          expect({ tool, ...(await run("main", { agent: "explore", tool: id(tool) })) }).toMatchObject({ tool, asked: [], error: { tag: "Permission.BlockedError" } })
        }
        expect(calls()).toEqual([])
      })

      test("an agent defined only in user config misses the block, and status names it with the per-agent fix", async () => {
        const calls = received()
        expect(await run("main", { agent: "reviewer", tool: id("update_folder"), input: { folder_id: "f-1" } })).toMatchObject({ asked: [] })
        expect(calls()).toEqual(["update_folder"])
        const current = await status("main")
        expect(current.unguardedAgents).toEqual(["reviewer"])
        expect(current.permissionsBlock).toEqual(defaultRules())
        expect(current.nextStep).toBe(AGENT_FIX)
      })

      test("with the per-agent fix, that agent carries the block and the user's own rules still win", async () => {
        expect(await run("main", { agent: "fixed", tool: id("get_meetings"), input: { meeting_ids: [MEETING] } })).toMatchObject({ asked: [] })
        expect(await run("main", { agent: "fixed", tool: id("update_folder"), input: { folder_id: "f-1" } })).toMatchObject({ asked: [] })
        expect(await run("main", { agent: "fixed", tool: id("create_folder"), input: { title: "Notes" } })).toMatchObject({ asked: [] })
        expect(await run("main", { agent: "fixed", tool: id("remove_note_from_folder") })).toMatchObject({ asked: [], error: { tag: "Permission.BlockedError" } })
        expect(await run("main", { agent: "explore", tool: id("get_meetings") })).toMatchObject({ asked: [], error: { tag: "Permission.BlockedError" } })
      })
    })

    describe("status", () => {
      test("connected: the RPC reports the server title, tool counts, export folder and versions", async () => {
        expect(await status("main")).toMatchObject({
          state: "connected",
          title: TITLE,
          tools: { visible: TOOLS.read.length + TOOLS.write.length + TOOLS.unknown.length, hidden: TOOLS.hidden.length, unknown: TOOLS.unknown.length, unknownNames: [...TOOLS.unknown] },
          exportDirectory: host.exports("main"),
          version: VERSION,
          host: { version: host.version, range: ">=2.2.3 <2.3.0", tested: true },
        })
        const current = await status("main")
        expect(["problem", "conflict", "hostWarning"].filter((key) => Object.hasOwn(current, key))).toEqual([])
      })

      test("/granola-status posts the RPC's model", async () => {
        const current = await status("main")
        expect(await slashStatus("main")).toBe(formatStatus(current))
      })

      test("needs_auth: AUTH_REQUIRED, with no Granola tools and nothing echoed from the host's error", async () => {
        const current = await statusWhen("needs-auth", settled)
        expect(current).toMatchObject({ state: "sign_in_required", problem: { code: "AUTH_REQUIRED" }, tools: { visible: 0, unknown: 0 } })
        expect(JSON.stringify(current)).not.toMatch(/https?:\/\//)
        expect((await state("needs-auth")).tools.map((tool) => tool.id).sort()).toEqual([id("events_list"), id("export_markdown")])
      })

      test("pending: CONNECTING while the server has not answered", async () => {
        const current = await statusWhen("pending", (value) => value.state !== "not_configured")
        expect(current).toMatchObject({ state: "connecting", problem: { code: "CONNECTING" }, tools: { visible: 0 } })
        await sleep(2_000)
        expect((await status("pending")).state).toBe("connecting")
      })
    })

    describe("Code Mode with nobody present", () => {
      test("an account read runs without asking, and status then shows the workspace", async () => {
        const result = await codeMode("main", `await tools.granola.get_account_info({}); throw new Error("SEEN " + JSON.stringify("read"))`)
        expect(result).toEqual({ seen: "read" })
        expect(await status("main")).toMatchObject({ state: "connected", workspace: WORKSPACE })
      })

      test("a write runs: every tool is allowed, so nobody needs to approve it", async () => {
        const calls = received()
        const result = await codeMode("main", `await tools.granola.update_folder({ folder_id: "f-1" }); throw new Error("SEEN " + JSON.stringify("ran"))`)
        expect(result).toEqual({ seen: "ran" })
        expect(calls()).toEqual(["update_folder"])
      })

      // R2: an ask and a deny are refused with nothing sent, and a name that is not a tool is refused, all inside
      // Code Mode's `execute`, where no prompt can be answered.
      test("under ask-changes an ask is refused with nothing sent; a deny is refused; an unknown name is refused", async () => {
        await statusWhen("ask-changes", connected)
        const calls = received()
        const asked = await codeMode("ask-changes", `await tools.granola.update_folder({ folder_id: "f-1" }); throw new Error("SEEN " + JSON.stringify("ran"))`)
        expect(asked).toEqual({ refused: expect.stringContaining(`Permission ${id("update_folder")} needs approval`) })
        expect(calls()).toEqual([])
        const read = await codeMode("ask-changes", `await tools.granola.get_meetings({ meeting_ids: [${JSON.stringify(MEETING)}] }); throw new Error("SEEN " + JSON.stringify("read"))`)
        expect(read).toEqual({ seen: "read" })
        expect(calls()).toEqual(["get_meetings"])
        const denied = await codeMode("read-only", `await tools.granola.update_folder({ folder_id: "f-1" }); throw new Error("SEEN " + JSON.stringify("ran"))`)
        // A deny also hides the tool from Code Mode's catalog, so the refusal names it either way.
        expect(denied).toEqual({ refused: expect.stringMatching(new RegExp(`(Permission denied|needs approval):? ?${id("update_folder")}|Unknown Code Mode tool: granola\\.update_folder`)) })
        const unknown = await codeMode("main", `await tools.granola.shiny_new_tool({}); throw new Error("SEEN " + JSON.stringify("ran"))`)
        expect(unknown).toEqual({ refused: expect.stringContaining("granola.shiny_new_tool") })
        expect(calls()).toEqual(["get_meetings"])
      })

      test("sign_out cannot be called", async () => {
        const calls = received()
        const result = await codeMode("main", `await tools.granola.sign_out({}); throw new Error("SEEN " + JSON.stringify("ran"))`)
        expect(result).toEqual({ refused: expect.stringContaining("granola.sign_out") })
        expect(calls()).toEqual([])
      })

      test("where the user's rule allows exports, the export is written and its output passes OpenCode's check", async () => {
        await statusWhen("automation", connected)
        const result = await codeMode("automation", [
          `const saved = await tools.granola.export_markdown({ meeting_ids: [${JSON.stringify(MEETING)}], content: "both", path: "brief.md" })`,
          `throw new Error("SEEN " + JSON.stringify(saved))`,
        ].join("\n"))
        const file = join(host.exports("automation"), "brief.md")
        expect(result).toEqual({ seen: { path: file, bytes: expect.any(Number), sha256: expect.stringMatching(/^[0-9a-f]{64}$/) } })
        const data = readFileSync(file)
        const { seen } = result as { seen: { bytes: number; sha256: string } }
        expect(data.length).toBe(seen.bytes)
        expect(createHash("sha256").update(data).digest("hex")).toBe(seen.sha256)
      })

      test("under ask-changes an export asks, so nothing is written", async () => {
        await statusWhen("ask-changes", connected)
        const calls = received()
        const result = await codeMode("ask-changes", `await tools.granola.export_markdown({ meeting_ids: [${JSON.stringify(MEETING)}], content: "notes", path: "manual/brief.md" }); throw new Error("SEEN " + JSON.stringify("ran"))`)
        expect(result).toEqual({ refused: expect.stringContaining(`Permission ${id("export_markdown")} needs approval`) })
        expect(existsSync(join(host.exports("ask-changes"), "manual"))).toBe(false)
        expect(calls()).toEqual([])
      })
    })

    describe("export_markdown", () => {
      const exportInput = (path: string) => ({ meeting_ids: [MEETING], content: "both", path })

      test("at the default access it runs without asking", async () => {
        const calls = received()
        const result = await run("main", { agent: "build", tool: id("export_markdown"), input: exportInput("interactive/plain.md") })
        expect(result).toMatchObject({ asked: [], output: { path: join(host.exports("main"), "interactive", "plain.md") } })
        expect(calls()).toEqual(["get_meetings", "get_meeting_transcript"])
      })

      test("under ask-changes, rejected: asks once for the file's path, then reads and writes nothing", async () => {
        await statusWhen("ask-changes", connected)
        const calls = received()
        const result = await run("ask-changes", { agent: "build", tool: id("export_markdown"), input: exportInput("interactive/rejected.md"), replies: ["reject"] })
        expect(result).toMatchObject({
          asked: [{ action: id("export_markdown"), resources: ["interactive/rejected.md"], save: ["*"], metadata: { meeting_count: 1, content: "both", overwrite: false } }],
          error: { tag: "Permission.DeclinedError" },
        })
        expect(result.asked).toHaveLength(1)
        expect(calls()).toEqual([])
        expect(existsSync(join(host.exports("ask-changes"), "interactive"))).toBe(false)
      })

      test("under ask-changes, approved once: writes one readable file and returns its path, size and checksum", async () => {
        await statusWhen("ask-changes", connected)
        const calls = received()
        const result = await run("ask-changes", { agent: "build", tool: id("export_markdown"), input: exportInput("interactive/approved.md"), replies: ["once"] })
        const file = join(host.exports("ask-changes"), "interactive", "approved.md")
        expect(result).toMatchObject({ asked: [{ action: id("export_markdown") }], output: { path: file } })
        const { output } = result as { output: { bytes: number; sha256: string } }
        const data = readFileSync(file)
        expect(data.length).toBe(output.bytes)
        expect(createHash("sha256").update(data).digest("hex")).toBe(output.sha256)
        const markdown = data.toString("utf8")
        expect(markdown).toMatch(/^---\n/)
        expect(markdown).toContain("Weekly sync")
        expect(markdown).toContain("Ship the export")
        expect(markdown).toContain("Welcome to the weekly sync")
        expect(calls()).toEqual(["get_meetings", "get_meeting_transcript"])
        expect(readdirSync(join(host.exports("ask-changes"), "interactive"))).toEqual(["approved.md"])
      })

      test("without transcripts on the plan, a transcript export writes the notes and says why", async () => {
        const calls = received()
        const input = { meeting_ids: [PLAN_LIMITED], content: "transcript", path: "scheduled/free-plan.md" }
        const result = await run("main", { agent: "build", tool: id("export_markdown"), input })
        expect(result).toMatchObject({ asked: [], output: { path: join(host.exports("main"), "scheduled", "free-plan.md") } })
        const markdown = readFileSync(join(host.exports("main"), "scheduled", "free-plan.md"), "utf8")
        expect(markdown).toContain("_No transcript: transcripts are not available on your Granola plan._")
        expect(markdown).toContain("No meeting matches the requested IDs.")
        expect(calls()).toEqual(["get_meeting_transcript", "get_meetings"])
      })

      test("the user's rule for a folder lets exports into it run without asking", async () => {
        const result = await run("main", { agent: "build", tool: id("export_markdown"), input: exportInput("scheduled/notes.md") })
        expect(result).toMatchObject({ asked: [], output: { path: join(host.exports("main"), "scheduled", "notes.md") } })
        expect(existsSync(join(host.exports("main"), "scheduled", "notes.md"))).toBe(true)
      })
    })

    // Saved approvals apply to the whole project, so these run last in the main project, on one tool whose agent asks.
    describe("a saved approval", () => {
      test("replying always lets the next call run without asking", async () => {
        const calls = received()
        expect(await run("main", { agent: "careful", tool: id("get_meetings"), input: { meeting_ids: [MEETING] }, replies: ["always"] })).toMatchObject({ asked: [{ action: id("get_meetings") }] })
        expect(await run("main", { agent: "careful", tool: id("get_meetings"), input: { meeting_ids: [MEETING] } })).toMatchObject({ asked: [] })
        expect(calls()).toEqual(["get_meetings", "get_meetings"])
        const saved = await host.client.permission.saved.list({}, header("main"))
        expect(saved.map((entry) => [entry.action, entry.resource])).toContainEqual([id("get_meetings"), "*"])
        // The save is per action and resource "*": build, which had no ask of its own, was never asked.
        expect(await run("main", { agent: "build", tool: id("get_meetings"), input: { meeting_ids: [MEETING] } })).toMatchObject({ asked: [] })
        expect(calls()).toEqual(["get_meetings", "get_meetings", "get_meetings"])
      })

      test("the user's deny still wins over it", async () => {
        expect(await run("main", { agent: "general", tool: id("get_meetings") })).toMatchObject({ asked: [], error: { tag: "Permission.BlockedError" } })
      })
    })

    describe("the tools RPC for scripts", () => {
      const sessions: Record<string, string> = {}
      const scriptRule = (action: string, effect: Rule["effect"]): Rule => ({ action, resource: "*", effect })
      /** A tools RPC call's output, or its error's type, code, next step and message. */
      async function script(project: Project, method: string, input: unknown): Promise<Record<string, any>> {
        try {
          return { value: (await host.client.rpc.call({ rpcID: TOOLS_RPC_ID, method, input: input as never, ...at(project) })).output }
        } catch (error) {
          const e = error as Record<string, any>
          return { type: e.type ?? e._tag, code: e.data?.code, next: e.data?.next, message: String(e.message ?? e) }
        }
      }
      const call = (session: string, method: string, input: unknown, project: Project = "main") =>
        script(project, method, { sessionID: sessions[session] ?? session, input })

      beforeAll(async () => {
        await statusWhen("main", connected)
        const create = async (input: Record<string, unknown>) => (await host.client.session.create({ title: "Granola script", ...at("main"), ...input })).id
        sessions.build = await create({ agent: "build" })
        sessions.locked = await create({ agent: "locked" })
        sessions.careful = await create({ agent: "careful" })
        sessions.agentless = await create({})
        // Session rules come after the agent's: one narrows build, the other reopens one read for locked.
        sessions.narrow = await create({ agent: "build", permissions: [scriptRule(id("get_meetings"), "deny")] })
        sessions.reopen = await create({ agent: "locked", permissions: [scriptRule(id("get_meetings"), "allow")] })
      }, 60_000)

      test("describe lists every known tool with its class, and the live schemas of those Granola offers", async () => {
        const { value } = await script("main", "describe", {})
        expect(value.id).toBe(TOOLS_RPC_ID)
        expect(Object.fromEntries(value.methods.map((method: { name: string; class: string }) => [method.name, method.class]))).toEqual(
          Object.fromEntries([...METHODS.map(method => [method.name, method.class]), ["export_markdown", "export"], ["events_list", "read"]]),
        )
        // An MCP method is available exactly when the connected server lists it.
        for (const method of value.methods.filter((entry: { kind: string }) => entry.kind === "mcp")) {
          const listed = [...TOOLS.read, ...TOOLS.write].includes(method.name)
          expect({ name: method.name, available: method.available }).toEqual({ name: method.name, available: listed })
          if (!listed) expect(method.reason).toBe("TOOL_UNAVAILABLE")
        }
        const listed = value.methods.find((method: { name: string }) => method.name === "get_meetings")
        expect(listed.input).toMatchObject({ type: "object", properties: { meeting_ids: { type: "array" } } })
        expect(value.methods.find((method: { name: string }) => method.name === "export_markdown")).toMatchObject({ kind: "plugin", class: "export", action: id("export_markdown") })
      })

      test("a write is a method that runs at the default access, and a session's ask refuses it before Granola runs", async () => {
        const calls = received()
        expect(await call("build", "update_folder", { folder_id: "f-1", title: "Scripted" })).toMatchObject({ value: expect.anything() })
        expect(calls()).toEqual(["update_folder"])
        // The careful agent asks for one read: the same shape a restricted access value gives.
        const asked = await call("careful", "get_meetings", { meeting_ids: [MEETING] })
        expect(asked).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
        expect(JSON.stringify(asked)).toContain("would ask")
        const denied = await host.client.session.create({ title: "No write", ...at("main"), agent: "build", permissions: [scriptRule(id("create_folder"), "deny")] })
        expect(await call(denied.id, "create_folder", { title: "No" })).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
        expect(calls()).toEqual(["update_folder"])
      })

      test("the export is a method that writes a file at the default access, and never past a session deny", async () => {
        const written = await call("build", "export_markdown", { meeting_ids: [MEETING], content: "notes", path: "script/default.md" })
        expect(written, JSON.stringify(written)).toMatchObject({ value: { path: expect.stringMatching(/\.md$/), bytes: expect.any(Number), sha256: expect.stringMatching(/^[0-9a-f]{64}$/) } })
        const denied = await host.client.session.create({ title: "No export", ...at("main"), agent: "build", permissions: [scriptRule(id("export_markdown"), "deny")] })
        expect(await call(denied.id, "export_markdown", { meeting_ids: [MEETING], content: "notes", path: "script/denied.md" })).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
        expect(existsSync(join(host.exports("main"), "script", "denied.md"))).toBe(false)
      })

      test("an unknown tool is no method, and a session rule can narrow a write", async () => {
        for (const name of ["brand_new_tool"]) {
          const result = await call("build", name, {})
          expect({ name, failed: result.type === "failed", missing: /not.?found|unknown/i.test(result.message ?? "") }).toEqual({ name, failed: false, missing: true })
        }
        const narrowed = await host.client.session.create({ title: "Narrow", ...at("main"), agent: "build", permissions: [scriptRule(id("create_folder"), "allow"), { ...scriptRule(id("create_folder"), "deny") }] })
        expect(await call(narrowed.id, "create_folder", { title: "No" })).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
      })

      test("runs a known read as a session whose agent allows it, with no model turn", async () => {
        const calls = received()
        // A result with only text has that text as its output too, as OpenCode's executor gives it.
        const meetings = await call("build", "get_meetings", { meeting_ids: [MEETING] })
        expect(meetings.value.text).toContain(`id="${MEETING}"`)
        expect(meetings.value).toEqual({ output: meetings.value.text, text: meetings.value.text })
        const transcript = await call("build", "get_meeting_transcript", { meeting_id: MEETING })
        expect(transcript.value).toMatchObject({ output: { meeting_id: MEETING, transcript: expect.stringContaining("Welcome") }, text: expect.any(String) })
        expect(calls()).toEqual(["get_meetings", "get_meeting_transcript"])
        const session = await host.client.session.get({ sessionID: sessions.build! })
        expect(session.tokens).toMatchObject({ input: 0, output: 0 })
      })

      test("events_list lists the meeting as Memory's event, with the signed-in email as its owner", async () => {
        const calls = received()
        const result = await call("build", "events_list", { since: "2026-10-01" })
        expect(result.value).toMatchObject({
          source: "granola",
          account: "default",
          owner: { id: `mailto:${EMAIL}`, label: EMAIL },
          events: [{ source: "granola", external_id: MEETING, kind: "meeting", occurred_at: new Date(MEETING_AT).toISOString(), title: "Weekly sync", url: `https://notes.example.test/d/${MEETING}` }],
          trust: "untrusted",
        })
        expect(result.value.events[0].text).toContain("Ship the export")
        expect(new Set(calls())).toEqual(new Set(["get_account_info", "search_meetings", "get_meetings"]))
        expect(await call("build", "events_list", { cursor: "not-a-cursor" })).toMatchObject({ type: "failed", code: "EVENTS_CURSOR_INVALID" })
      })

      test("an account read records the workspace that status shows, as the model path does", async () => {
        // Nothing has read the account in the adopted project yet; the script's session belongs to main.
        expect(Object.hasOwn(await statusWhen("adopted", connected), "workspace")).toBe(false)
        expect((await call("build", "get_account_info", {}, "adopted")).value).toMatchObject({ text: expect.stringContaining(WORKSPACE) })
        expect(await status("adopted")).toMatchObject({ workspace: WORKSPACE })
      })

      test("refuses a session whose agent denies Granola, before Granola is called", async () => {
        const calls = received()
        expect(await call("locked", "get_meetings", { meeting_ids: [MEETING] })).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
        expect(calls()).toEqual([])
      })

      test("refuses an ask at once, and leaves no approval prompt waiting", async () => {
        const calls = received()
        const started = Date.now()
        const result = await call("careful", "get_meetings", { meeting_ids: [MEETING] })
        expect(result).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
        expect(result.message).toMatch(/cannot answer/)
        expect(Date.now() - started).toBeLessThan(5_000)
        const { data: pending } = await host.client.permission.request.list(at("main"))
        expect(pending.filter((request) => JSON.stringify(request).includes(sessions.careful!))).toEqual([])
        expect(calls()).toEqual([])
        // The same agent's other reads have no ask, so they run.
        expect((await call("careful", "list_meetings", {})).value).toMatchObject({ text: expect.any(String) })
      })

      test("applies the session's rules after the agent's", async () => {
        expect(await call("narrow", "get_meetings", { meeting_ids: [MEETING] })).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
        expect((await call("narrow", "list_meetings", {})).value).toMatchObject({ text: expect.any(String) })
        expect((await call("reopen", "get_meetings", { meeting_ids: [MEETING] })).value).toMatchObject({ text: expect.stringContaining(MEETING) })
        expect(await call("reopen", "list_meetings", {})).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
      })

      // R18: one host per access value, on the tools RPC path, where a refusal must reach nothing.
      test("ask-changes: its own block, a read runs, and a change is refused before Granola runs", async () => {
        await statusWhen("ask-changes", connected)
        const agent = (await state("ask-changes")).agents.find((entry) => entry.id === "build")!
        const base = agent.permissions.findIndex(isBaseAllow)
        expect(agent.permissions.slice(base + 1, base + 1 + defaultRules("ask-changes").length)).toEqual(defaultRules("ask-changes"))
        const session = (await host.client.session.create({ title: "Ask changes", ...at("ask-changes"), agent: "build" })).id
        const calls = received()
        expect((await call(session, "list_meetings", {}, "ask-changes")).value).toMatchObject({ text: expect.any(String) })
        const refused = await call(session, "update_folder", { folder_id: "f-1" }, "ask-changes")
        expect(refused).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
        expect(JSON.stringify(refused)).toContain("would ask")
        const exported = await call(session, "export_markdown", { meeting_ids: [MEETING], content: "notes" }, "ask-changes")
        expect(exported).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
        expect(calls()).toEqual(["list_meetings"])
        expect(await status("ask-changes")).toMatchObject({ access: "ask-changes" })
        expect(formatStatus(await status("ask-changes"))).toContain("Access: reads run without asking; changes, new tools and exports ask first")
      })

      test("read-only: its own block, a read runs, and every other tool is denied", async () => {
        await statusWhen("read-only", connected)
        const agent = (await state("read-only")).agents.find((entry) => entry.id === "build")!
        const base = agent.permissions.findIndex(isBaseAllow)
        expect(agent.permissions.slice(base + 1, base + 1 + defaultRules("read-only").length)).toEqual(defaultRules("read-only"))
        const session = (await host.client.session.create({ title: "Read only", ...at("read-only"), agent: "build" })).id
        const calls = received()
        expect((await call(session, "list_meetings", {}, "read-only")).value).toMatchObject({ text: expect.any(String) })
        expect(await call(session, "update_folder", { folder_id: "f-1" }, "read-only")).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
        expect(await call(session, "give_feedback", {}, "read-only")).toMatchObject({ type: "failed", code: "PERMISSION_DENIED" })
        expect(calls()).toEqual(["list_meetings"])
        expect(await status("read-only")).toMatchObject({ access: "read-only" })
        expect(formatStatus(await status("read-only"))).toContain("Access: reads run without asking; every other tool is denied")
      })

      test("gives Granola's own error as UPSTREAM_ERROR: its first line, with the signed URL redacted", async () => {
        const result = await call("build", "get_meeting_transcript", { meeting_id: FAILING })
        expect(result).toMatchObject({ type: "failed", code: "UPSTREAM_ERROR" })
        expect(result.message).toContain("https://files.example.invalid/t.json?[redacted]")
        for (const hidden of ["fake-signature-123", "second line"]) expect(result.message).not.toContain(hidden)
        expect(UPSTREAM_FAILURE).toContain("fake-signature-123")
      })

      test("names a read the server does not offer, a server that needs a sign-in, and the user's own server", async () => {
        expect(await call("build", "list_templates", {})).toMatchObject({ type: "failed", code: "TOOL_UNAVAILABLE", next: toolUnavailable("list_templates").next })
        await statusWhen("needs-auth", settled)
        const signIn = connectionProblem("needs_auth")!
        expect(await call("build", "list_meetings", {}, "needs-auth")).toMatchObject({ type: "failed", code: signIn.code, next: signIn.next })
        const calls = received()
        expect(await call("build", "list_meetings", {}, "conflict")).toMatchObject({ type: "failed", code: "SERVER_CONFLICT", next: CONFLICT_NEXT })
        expect(calls()).toEqual([])
      })

      test("names an unknown session, a session without an agent, and rejects an envelope with extra keys", async () => {
        expect(await call("ses_does_not_exist", "list_meetings", {})).toMatchObject({ type: "failed", code: "SESSION_UNKNOWN" })
        expect(await call("agentless", "list_meetings", {})).toMatchObject({ type: "failed", code: "SESSION_AGENT_REQUIRED" })
        const calls = received()
        for (const envelope of [{ sessionID: sessions.build, input: {}, extra: true }, { input: {} }, { sessionID: sessions.build, input: "q" }])
          expect(await script("main", "list_meetings", envelope)).toMatchObject({ type: "rpc.invalid_input" })
        expect(calls()).toEqual([])
      })
    })

    describe("unloading", () => {
      test("removes the server, tools, rules, commands, skills and RPC", async () => {
        const loaded = await statusWhen("unload", connected)
        expect(loaded.state).toBe("connected")
        expect((await host.client.command.list(at("unload"))).data.map((command) => command.name)).toContain("granola-status")

        host.removePlugin("unload")
        await host.client.location.reload(header("unload"))
        for (const deadline = Date.now() + 60_000; Date.now() < deadline; await sleep(250)) {
          const plugins = (await host.client.plugin.list(at("unload"))).data
          if (!plugins.some((plugin) => plugin.id === "granola.meetings") && plugins.some((plugin) => plugin.id === "granola.test.probe")) break
        }

        const after = await state("unload")
        expect((await host.client.plugin.list(at("unload"))).data.map((plugin) => plugin.id)).not.toContain("granola.meetings")
        expect(after.registered).toBeNull()
        expect(after.servers.map((server) => server.name)).not.toContain("granola")
        expect(after.tools).toEqual([])
        expect(after.agents.flatMap((agent) => granolaRules(agent.permissions))).toEqual([])
        expect((await host.client.command.list(at("unload"))).data.map((command) => command.name).filter((command) => command.startsWith("granola"))).toEqual([])
        expect((await host.client.skill.list(at("unload"))).data.map((skill) => skill.id).filter((skill) => skill.startsWith("granola"))).toEqual([])
        await expect(status("unload")).rejects.toThrow()
      })
    })

    // The /connect mark is only observable while a credential remains, so this signs in through the fake's own
    // authorization and token endpoints with a token that has no refresh token: a 401 then needs a new sign-in rather
    // than a refresh, and the account stays. The plugin reads its mark back from the projected connection, so the mark
    // it sets is the one it clears.
    describe("the /connect sign-in mark", () => {
      /** The sign-in project's /connect connections, with the status a credential shows there. */
      const connections = async () => {
        const integrationID = (await host.client.mcp.list(at("sign-in"))).data.find((entry) => entry.name === "granola")?.integrationID
        if (!integrationID) return []
        const { data } = await host.client.integration.get({ integrationID, ...at("sign-in") })
        return (data as unknown as { connections?: { type?: string; status?: { status: string; message?: string } }[] }).connections ?? []
      }

      /** Signs in through OpenCode's own flow: the authorization endpoint redirects the loopback callback, which exchanges its code. */
      const signIn = async () => {
        const integrationID = (await host.client.mcp.list(at("sign-in"))).data.find((entry) => entry.name === "granola")!.integrationID!
        const { data: integration } = await host.client.integration.get({ integrationID, ...at("sign-in") })
        const oauth = (host.client.integration as unknown as { oauth: { connect: (input: object) => Promise<{ data: { attemptID: string; url: string } }> } }).oauth
        const { methods } = integration as unknown as { methods: { id: string }[] }
        const { data: attempt } = await oauth.connect({ integrationID, methodID: methods[0]!.id, ...at("sign-in") })
        const redirect = await fetch(attempt.url, { redirect: "manual" })
        const callback = redirect.headers.get("location")
        expect(callback).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//)
        await fetch(callback!)
      }

      /** Polls `check` until it returns a value. */
      const waitFor = async <T>(what: string, check: () => Promise<T | false | undefined>): Promise<T> => {
        for (const deadline = Date.now() + 60_000; ; await sleep(250)) {
          const value = await check()
          if (value) return value
          if (Date.now() > deadline) throw new Error(`timed out waiting until ${what}`)
        }
      }

      test("is set while the server needs a sign-in, and cleared once the same account connects again", async () => {
        // The fake is shared by every host's suite: start from a connected server, then challenge it, and ask for no
        // refresh token.
        await statusWhen("sign-in", settled)
        fake().challenge = true
        fake().issueRefreshToken = false
        const mcp = host.client.mcp as unknown as Record<"connect" | "disconnect", (input: object) => Promise<unknown>>
        await mcp.disconnect({ server: "granola", ...at("sign-in") }).catch(() => undefined)
        await mcp.connect({ server: "granola", ...at("sign-in") }).catch(() => undefined)
        await statusWhen("sign-in", (current) => current.state === "sign_in_required")
        const stored = fake().tokens.length
        await signIn()
        await waitFor("the sign-in stores a token without a refresh token", async () => fake().tokens.length > stored)
        expect(fake().tokens.at(-1)).toMatchObject({ grant_type: "authorization_code" })
        expect(fake().tokens.at(-1)).not.toHaveProperty("refresh_token")
        fake().challenge = false
        await statusWhen("sign-in", connected)
        expect(await waitFor("/connect shows the account", async () => (await connections()).find((item) => item.type === "credential" && item.status?.message === undefined))).toBeDefined()

        // The token stops working, and there is no refresh token: a new sign-in, with the credential kept.
        fake().challenge = true
        await mcp.disconnect({ server: "granola", ...at("sign-in") })
        await mcp.connect({ server: "granola", ...at("sign-in") }).catch(() => undefined)
        await statusWhen("sign-in", (current) => current.state === "sign_in_required")
        expect(await waitFor("/connect shows the new sign-in on the account", async () => (await connections()).find((item) => item.status?.message === SIGN_IN_MESSAGE))).toBeDefined()

        // The same account connects again: the plugin clears its own mark.
        fake().challenge = false
        await mcp.connect({ server: "granola", ...at("sign-in") })
        await statusWhen("sign-in", connected)
        expect(await waitFor("/connect clears the sign-in mark", async () => ((await connections()).some((item) => item.status?.message) ? undefined : true))).toBe(true)
      })
    })

    test("writes nothing outside its temp root", () => {
      expect(repositoryChanges()).toBe(changesBefore)
      // The host's own state and data folders landed inside the root, so its XDG redirection took effect.
      expect(existsSync(join(host.root, host.state))).toBe(true)
      expect(readdirSync(join(host.root, "home", ".local", "share", "opencode")).length).toBeGreaterThan(0)
    })
  })
}
