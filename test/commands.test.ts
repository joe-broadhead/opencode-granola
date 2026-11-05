import { describe, expect, it } from "vitest"
import { STATUS_COMMAND, registerCommands } from "../src/commands.js"
import { STATUS_UNAVAILABLE, describe as describeProblem } from "../src/errors.js"
import { readPackageInfo } from "../src/meta.js"
import type { Status } from "../src/status.js"
import { fakeHost } from "./fakes.js"

const VERSION = readPackageInfo().version

const status: Status = {
  state: "sign_in_required",
  problem: { code: "AUTH_REQUIRED", message: "Granola needs you to sign in." },
  tools: { visible: 0, hidden: 0, unknown: 0, unknownNames: [] },
  unguardedAgents: [],
  shadowedSkills: [],
  exportDirectory: "/x",
  version: VERSION,
  host: { version: "2.2.3", range: ">=2.2.3 <2.3.0", tested: true },
  nextStep: "Run `/connect` and choose Granola.",
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
