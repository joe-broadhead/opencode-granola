import { describe, expect, it } from "vitest"
import { STATUS_COMMAND, registerCommands } from "../src/commands.js"
import { STATUS_UNAVAILABLE, describe as describeProblem } from "../src/errors.js"
import { readPackageInfo } from "../src/meta.js"
import type { Status } from "../src/status.js"
import { fakeHost } from "./fakes.js"

const VERSION = readPackageInfo().version

const status: Status = {
  state: "needs_auth",
  problem: { code: "AUTH_REQUIRED", message: "Granola needs you to sign in.", next: "Run `/connect` and choose Granola." },
  tools: { visible: 0, hidden: 0, unknown: 0, unknownNames: [] },
  unguardedAgents: [],
  exportDirectory: "/x",
  pluginVersion: VERSION,
  hostVersion: "2.2.3",
  next: "Run `/connect` and choose Granola.",
}

describe("commands", () => {
  it("posts /granola-status as a synthetic notice without starting a model turn", async () => {
    const host = fakeHost()
    await registerCommands(host.ctx, { read: async () => status })
    await host.commands.get(STATUS_COMMAND)!.execute({ sessionID: "ses_1", delivery: "queue", prompt: {} })
    expect(host.synthetic).toEqual([{
      sessionID: "ses_1", delivery: "queue", resume: false, description: "Granola status",
      text: expect.stringContaining("Connection: sign-in required"),
    }])
  })

  it("posts a fixed message with a next step when status cannot be read", async () => {
    const host = fakeHost()
    await registerCommands(host.ctx, { read: async () => { throw new Error("secret internal detail") } })
    await host.commands.get(STATUS_COMMAND)!.execute({ sessionID: "ses_1", delivery: "steer", prompt: {} })
    expect(host.synthetic[0]).toMatchObject({ text: describeProblem(STATUS_UNAVAILABLE), delivery: "steer" })
    expect(JSON.stringify(host.synthetic)).not.toContain("secret internal detail")
  })
})
