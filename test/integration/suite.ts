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
import { KNOWN_READS, TOOLS_RPC_ID } from "../../src/host/tools-rpc.js"
import { HIDDEN_TOOLS, PLUGIN_TOOLS, WRITE_TOOLS } from "../../src/known-tools.js"
import { DEFAULT_RULES, type Rule } from "../../src/permissions.js"
import { Granola, type Status } from "../../src/rpc/contract.js"
import { AGENT_FIX, CONFLICT_NEXT, formatStatus, shadowedFix } from "../../src/status.js"
import { FAILING, MEETING, PLAN_LIMITED, TITLE, TOOLS, UPSTREAM_FAILURE, WORKSPACE, type SyntheticGranola } from "../synthetic-granola/server.js"
import { ADOPTED_SERVER, globalPaths, OFFICIAL_URL, OTHER_SERVER, repositoryChanges, REPO, SHADOWING_SKILL, type Host, type Project } from "./harness.js"
import type { CallInput, CallResult, Outcome, ProbeState } from "./probe/index.js"

const VERSION = (JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")) as { version: string }).version
const SKILLS = ["granola", "granola-meeting-brief"]
/** Agents defined only in the main project's config; OpenCode creates them after package plugins run. */
const CONFIG_ONLY = ["reviewer", "fixed", "locked", "careful"]

const isBaseAllow = (rule: Rule) => rule.action === "*" && rule.resource === "*" && rule.effect === "allow"
const blocks = (permissions: readonly Rule[]) => permissions.filter((rule) => rule.action === "granola_*" && rule.effect === "ask").length
const granolaRules = (permissions: readonly Rule[]) => permissions.filter((rule) => rule.action.startsWith("granola"))
const id = (name: string) => `granola_${name}`
/** OpenCode has registered the server and finished its first connection attempt. */
const settled = (current: Status) => current.state !== "connecting" && current.state !== "not_configured"
/** Connected, with Granola's tools in the registry: OpenCode can report connected before it lists them. */
const connected = (current: Status) => current.state === "connected" && current.tools.visible > 0

export function hostSuite(name: string, start: (fake: SyntheticGranola) => Promise<Host>, fake: () => SyntheticGranola): void {
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

      test("Granola's tools sit in the granola namespace next to the plugin's export tool; sign_out is removed", async () => {
        const { tools } = await state("main")
        const expected = [...TOOLS.read, ...TOOLS.write, ...TOOLS.unknown, "export_markdown"].map(id).sort()
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
          const rules = base === -1 ? [] : agent.permissions.slice(base + 1, base + 1 + DEFAULT_RULES.length)
          expect({ agent: agent.id, rules, blocks: blocks(agent.permissions) }).toEqual({ agent: agent.id, rules: base === -1 ? [] : DEFAULT_RULES, blocks: base === -1 ? 0 : 1 })
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
          if (base !== -1) permissions.splice(base + 1, DEFAULT_RULES.length)
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

      test.each(["update_folder", "brand_new_tool"])("%s asks first, and does not run when rejected", async (tool) => {
        const calls = received()
        const result = await run("main", { agent: "build", tool: id(tool), replies: ["reject"] })
        expect(result).toMatchObject({ asked: [{ action: id(tool), resources: ["*"], save: ["*"] }], error: { tag: "Permission.DeclinedError" } })
        expect(result.asked).toHaveLength(1)
        expect(calls()).toEqual([])
      })

      test("give_feedback is denied by default, and in an agent given the block by hand", async () => {
        expect(await check("main", "build", id("give_feedback"))).toEqual({ outcome: "deny" })
        expect(await check("main", "fixed", id("give_feedback"))).toEqual({ outcome: "deny" })
      })

      test("a write runs once approved", async () => {
        const calls = received()
        const result = await run("main", { agent: "build", tool: id("update_folder"), input: { folder_id: "f-1" }, replies: ["once"] })
        expect(result).toMatchObject({ asked: [{ action: id("update_folder") }] })
        expect(Object.hasOwn(result, "error")).toBe(false)
        expect(calls()).toEqual(["update_folder"])
      })

      test("the user's allow rule for a write removes the prompt", async () => {
        const calls = received()
        expect(await run("main", { agent: "build", tool: id("create_folder"), input: { title: "Notes" } })).toMatchObject({ asked: [], output: expect.anything() })
        expect(calls()).toEqual(["create_folder"])
      })

      test("the user's deny rule wins, without asking", async () => {
        const calls = received()
        expect(await run("main", { agent: "build", tool: id("remove_note_from_folder") })).toMatchObject({ asked: [], error: { tag: "Permission.BlockedError" } })
        // general's own rules deny every Granola tool, reads included.
        expect(await run("main", { agent: "general", tool: id("get_meetings"), input: { meeting_ids: [MEETING] } })).toMatchObject({ asked: [], error: { tag: "Permission.BlockedError" } })
        expect(calls()).toEqual([])
      })

      test("Plan is not weakened: reads run, writes ask, and its own edit rule still denies", async () => {
        expect(await run("main", { agent: "plan", tool: id("get_meetings"), input: { meeting_ids: [MEETING] } })).toMatchObject({ asked: [] })
        expect(await run("main", { agent: "plan", tool: id("update_folder"), replies: ["reject"] })).toMatchObject({ asked: [{ action: id("update_folder") }] })
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
        expect(await run("main", { agent: "reviewer", tool: id("update_folder") })).toMatchObject({ asked: [] })
        expect(calls()).toEqual(["update_folder"])
        const current = await status("main")
        expect(current.unguardedAgents).toEqual(["reviewer"])
        expect(current.permissionsBlock).toEqual(DEFAULT_RULES)
        expect(current.nextStep).toBe(AGENT_FIX)
      })

      test("with the per-agent fix, that agent asks before writes, the user's own rules still win, and Explore is not loosened", async () => {
        expect(await run("main", { agent: "fixed", tool: id("get_meetings"), input: { meeting_ids: [MEETING] } })).toMatchObject({ asked: [] })
        expect(await run("main", { agent: "fixed", tool: id("update_folder"), replies: ["reject"] })).toMatchObject({ asked: [{ action: id("update_folder") }], error: { tag: "Permission.DeclinedError" } })
        expect(await run("main", { agent: "fixed", tool: id("create_folder") })).toMatchObject({ asked: [] })
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
        expect((await state("needs-auth")).tools.map((tool) => tool.id).sort()).toEqual([id("export_markdown")])
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

      test("a write needs approval that nobody can give, so it is refused and does not run", async () => {
        const calls = received()
        const result = await codeMode("main", `await tools.granola.update_folder({ folder_id: "f-1" }); throw new Error("SEEN " + JSON.stringify("ran"))`)
        expect(result).toEqual({ refused: expect.stringContaining(`Permission ${id("update_folder")} needs approval`) })
        expect(calls()).toEqual([])
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

      test("otherwise an export needs approval that nobody can give, so nothing is written", async () => {
        const calls = received()
        const result = await codeMode("main", `await tools.granola.export_markdown({ meeting_ids: [${JSON.stringify(MEETING)}], content: "notes", path: "manual/brief.md" }); throw new Error("SEEN " + JSON.stringify("ran"))`)
        expect(result).toEqual({ refused: expect.stringContaining(`Permission ${id("export_markdown")} needs approval`) })
        expect(existsSync(join(host.exports("main"), "manual"))).toBe(false)
        expect(calls()).toEqual([])
      })
    })

    describe("export_markdown", () => {
      const exportInput = (path: string) => ({ meeting_ids: [MEETING], content: "both", path })

      test("rejected: asks once for the file's path, then reads and writes nothing", async () => {
        const calls = received()
        const result = await run("main", { agent: "build", tool: id("export_markdown"), input: exportInput("interactive/rejected.md"), replies: ["reject"] })
        expect(result).toMatchObject({
          asked: [{ action: id("export_markdown"), resources: ["interactive/rejected.md"], save: ["*"], metadata: { meeting_count: 1, content: "both", overwrite: false } }],
          error: { tag: "Permission.DeclinedError" },
        })
        expect(result.asked).toHaveLength(1)
        expect(calls()).toEqual([])
        expect(existsSync(join(host.exports("main"), "interactive"))).toBe(false)
      })

      test("approved once: writes one readable file through Granola's reads and returns its path, size and checksum", async () => {
        const calls = received()
        const result = await run("main", { agent: "build", tool: id("export_markdown"), input: exportInput("interactive/approved.md"), replies: ["once"] })
        const file = join(host.exports("main"), "interactive", "approved.md")
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
        expect(readdirSync(join(host.exports("main"), "interactive"))).toEqual(["approved.md"])
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

    // Saved approvals apply to the whole project, so these run last in the main project, on one tool.
    describe("a saved approval", () => {
      test("replying always lets the next call run without asking", async () => {
        const calls = received()
        expect(await run("main", { agent: "build", tool: id("add_note_to_folder"), replies: ["always"] })).toMatchObject({ asked: [{ action: id("add_note_to_folder") }] })
        expect(await run("main", { agent: "build", tool: id("add_note_to_folder") })).toMatchObject({ asked: [] })
        expect(calls()).toEqual(["add_note_to_folder", "add_note_to_folder"])
        const saved = await host.client.permission.saved.list({}, header("main"))
        expect(saved.map((entry) => [entry.action, entry.resource])).toContainEqual([id("add_note_to_folder"), "*"])
      })

      test("the user's deny still wins over it", async () => {
        expect(await run("main", { agent: "general", tool: id("add_note_to_folder") })).toMatchObject({ asked: [], error: { tag: "Permission.BlockedError" } })
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

      test("describe lists exactly the ten known reads, with the live schemas of those Granola offers", async () => {
        const { value } = await script("main", "describe", {})
        expect(value.id).toBe(TOOLS_RPC_ID)
        expect(value.methods.map((method: { name: string }) => method.name)).toEqual([...KNOWN_READS])
        const offered = value.methods.filter((method: { available: boolean }) => method.available).map((method: { name: string }) => method.name)
        expect(offered.sort()).toEqual([...TOOLS.read].sort())
        for (const method of value.methods) {
          expect(structuredClone(method)).toMatchObject({ kind: "mcp", tool: id(method.name), action: id(method.name) })
          if (!method.available) expect(method.reason).toBe("TOOL_UNAVAILABLE")
        }
        const listed = value.methods.find((method: { name: string }) => method.name === "get_meetings")
        expect(listed.input).toMatchObject({ type: "object", properties: { meeting_ids: { type: "array" } } })
      })

      test("a write, sign_out, export_markdown or an unknown tool is no method, even where a rule allows it", async () => {
        const calls = received()
        for (const name of [...WRITE_TOOLS, ...HIDDEN_TOOLS, ...PLUGIN_TOOLS, ...TOOLS.unknown]) {
          const result = await call("build", name, {})
          expect({ name, failed: result.type === "failed", missing: /not.?found|unknown/i.test(result.message ?? "") }).toEqual({ name, failed: false, missing: true })
        }
        expect(calls()).toEqual([])
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
        expect(result.message).toMatch(/cannot answer an approval prompt/)
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

    test("writes nothing outside its temp root", () => {
      expect(repositoryChanges()).toBe(changesBefore)
      // The host's own state and data folders landed inside the root, so its XDG redirection took effect.
      expect(existsSync(join(host.root, host.state))).toBe(true)
      expect(readdirSync(join(host.root, "home", ".local", "share", "opencode")).length).toBeGreaterThan(0)
    })
  })
}
