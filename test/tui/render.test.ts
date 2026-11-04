import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { beforeAll, describe, expect, it } from "vitest"

// OpenTUI 0.8 needs Bun, so the prebuilt dist/tui.js is rendered by harness.ts under Bun and checked here.
// Build it first with `npm run build`.
const root = fileURLToPath(new URL("../../", import.meta.url))

interface Result {
  modes: (string | undefined)[]
  commands: { id: string; title: string; group: string; palette: boolean; slash: { name: string } }[]
  dialog: string
  dialogKeys: string[]
  refresh: { beforeOpen: number; opened: number; whileOpen: number; afterClose: number }
  cleared: number
  rpc: { id: string; input: unknown; options: unknown }
  listenersAfterCleanup: number
  listeners: { beforeOpen: number; whileOpen: number; afterClose: number }
}

let results: Record<string, Result>

beforeAll(() => {
  const run = spawnSync("bun", ["--preload", "@opentui/solid/preload", "test/tui/harness.ts"], { cwd: root, encoding: "utf8", timeout: 90_000 })
  if (run.error) throw new Error(`Bun is required for the TUI render test: ${run.error.message}`)
  const line = run.stdout.split("\n").find((entry) => entry.startsWith("RESULT "))
  if (run.status !== 0 || !line) throw new Error(`TUI harness failed (exit ${run.status}):\n${run.stdout}\n${run.stderr}`)
  results = JSON.parse(line.slice("RESULT ".length))
}, 120_000)

const flat = (text: string) => text.replace(/\s+/g, " ").trim()
/** For long lines that OpenTUI wraps after "." or "-" as well as at spaces. */
const squash = (text: string) => text.replace(/\s+/g, "")

describe("prebuilt TUI part", () => {
  it("ships one plain JavaScript file that imports only host-provided modules", () => {
    const tui = readFileSync(new URL("../../dist/tui.js", import.meta.url), "utf8")
    expect(tui).not.toMatch(/<[A-Za-z]|: [A-Z][A-Za-z]+</)
    const specifiers = [...tui.matchAll(/^import .* from "([^"]+)";$/gm)].map((match) => match[1])
    expect(new Set(specifiers)).toEqual(new Set(["@opentui/solid", "solid-js", "@opencode/plugin/rpc"]))
    expect(tui).not.toMatch(/\bimport\s*\(|\brequire\s*\(/)
  })

  it("claims no slots and adds one global palette command, Granola: Status, with the slash /granola", () => {
    for (const result of Object.values(results)) {
      // The palette runs in its own input mode, so a base-mode command would not be listed there.
      expect(result.modes).toEqual(["global"])
      expect(result.commands).toEqual([{ id: "granola.status", title: "Granola: Status", group: "Granola", palette: true, slash: { name: "granola" } }])
    }
  })

  it("sign-in required: the Connection row, the code and one Next step", () => {
    const dialog = flat(results["needs sign-in"]!.dialog)
    expect(squash(dialog).startsWith(squash("Granola status Connection sign-in required: Granola needs you to sign in. (AUTH_REQUIRED)"))).toBe(true)
    expect(squash(dialog)).toContain(squash("Next step Run /connect and choose Granola, then press o or Enter to open the sign-in page (in a terminal, opencode mcp auth granola opens it automatically)."))
    expect(dialog.split("Next step").length).toBe(2)
    expect(dialog.endsWith("r refresh · esc close")).toBe(true)
  })

  it("connecting: says so", () => {
    expect(flat(results.connecting!.dialog)).toContain("Connection connecting: Granola is still connecting. (CONNECTING)")
    expect(flat(results.connecting!.dialog)).toContain("Next step Retry in a few seconds.")
  })

  it("connected: the shared rows in the shared order, and Nothing to do", () => {
    // The two-column layout wraps long labels and values, so compare without whitespace. The label column wraps
    // "Agents without default rules" after its value's first line.
    const dialog = squash(results["connected without a workspace"]!.dialog)
    const order = ["Connection connected (Granola)", "Account workspace unknown until the agent reads your Granola account", "Access reads run", "Export folder /home/someone/Granola", "Tools 17 available, 1 hidden", "Agents without none default rules", "OpenCode 2.2.3 (tested; supported range >=2.2.3 <2.3.0)", "Next step Nothing to do."]
    const positions = order.map((part) => dialog.indexOf(squash(part)))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(flat(results["connected with a workspace"]!.dialog)).toContain("Account workspace Acme Research")
  })

  it("RPC unavailable: says what is missing", () => {
    expect(flat(results["RPC unavailable"]!.dialog)).toContain("Connection unknown: the Granola plugin is not running on this OpenCode server")
  })

  it("status unreadable: names STATUS_UNAVAILABLE and says to refresh", () => {
    expect(squash(results["status unreadable"]!.dialog)).toContain(squash("Connection unknown: Granola status could not be read (STATUS_UNAVAILABLE)"))
    expect(squash(results["status unreadable"]!.dialog)).toContain(squash("Next step Press r to refresh in a few seconds."))
  })

  it("names agents without the default rules and shows the config to paste", () => {
    const dialog = squash(results["agents without the defaults"]!.dialog)
    for (const line of [
      "reviewer: Granola changes and new tools may run there",
      `{"action":"granola_*","resource":"*","effect":"ask"},`,
      `{"action":"granola_get_meetings","resource":"*","effect":"allow"},`,
    ]) expect(dialog).toContain(squash(line))
  })

  it("listens and fetches only while the dialog is open: on open, on r and on each relevant event", () => {
    for (const result of Object.values(results)) {
      expect(result.rpc).toEqual({ id: "granola.meetings", input: {}, options: { location: { directory: "/project" } } })
      expect(result.refresh).toEqual({ beforeOpen: 0, opened: 1, whileOpen: 8, afterClose: 0 })
      expect(result.listeners).toEqual({ beforeOpen: 0, whileOpen: 7, afterClose: 0 })
      expect(result.dialogKeys).toEqual(["r", "escape"])
      expect(result.cleared).toBe(1)
    }
  })

  it("removes its listeners on cleanup", () => {
    for (const result of Object.values(results)) expect(result.listenersAfterCleanup).toBe(0)
  })
})
