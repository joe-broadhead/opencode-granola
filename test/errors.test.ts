import { Error as ToolError } from "@opencode/plugin/promise/tool"
import { describe, expect, it } from "vitest"
import {
  GranolaError, STATUS_UNAVAILABLE, connectionProblem, packageInvalid, skillsInvalid, describe as describeProblem, hostUntested, invalidOption, shortReason, toolError, toolUnavailable,
  type ConnectionState,
} from "../src/errors.js"

describe("connection-state table", () => {
  const rows: [ConnectionState, string][] = [
    ["absent", "NOT_REGISTERED"],
    ["pending", "CONNECTING"],
    ["needs_auth", "AUTH_REQUIRED"],
    ["failed", "CONNECTION_FAILED"],
    ["disabled", "DISABLED"],
  ]

  it.each(rows)("maps %s to %s with a message and a next step", (state, code) => {
    const problem = connectionProblem(state, "boom")!
    expect(problem.code).toBe(code)
    expect(problem.message.length).toBeGreaterThan(10)
    expect(problem.next.length).toBeGreaterThan(10)
  })

  it("has no problem when connected", () => {
    expect(connectionProblem("connected")).toBeUndefined()
  })

  it("leads with /connect, says how the browser opens, gives the terminal path, and never echoes the host's needs_auth text", () => {
    const problem = connectionProblem("needs_auth", "visit https://auth.example/authorize?code=secret to continue")!
    expect(problem.next).toBe(
      "Run /connect and choose Granola, then press o or Enter to open the sign-in page (in a terminal, opencode mcp auth granola opens it automatically).",
    )
    expect(describeProblem(problem)).not.toMatch(/auth\.example|secret/)
  })

  it("keeps a short failed reason without URLs or control characters", () => {
    const problem = connectionProblem("failed", "fetch failed\n at https://mcp.granola.ai/mcp?token=abc  ")!
    expect(problem.message).toBe("Granola connection failed: fetch failed at <url>.")
    expect(shortReason("x".repeat(400))).toHaveLength(160)
    expect(shortReason(undefined)).toBe("no reason given")
  })

  it("adds no full stop after a reason that already ends a sentence", () => {
    const refused = "ECONNREFUSED: Unable to connect. Is the computer able to access the url?"
    expect(connectionProblem("failed", refused)!.message).toBe(`Granola connection failed: ${refused}`)
    expect(connectionProblem("failed", "Gone!")!.message).toBe("Granola connection failed: Gone!")
    expect(connectionProblem("failed", "x".repeat(400))!.message).toBe(`Granola connection failed: ${"x".repeat(157)}...`)
  })

  it("offers /mcps first for a disabled server, which is where it is usually turned off", () => {
    expect(connectionProblem("disabled")!.next).toBe('Enable granola in /mcps, or remove "disabled": true from mcp.servers.granola in your OpenCode config.')
  })

  it("points a missing server at what can remove it, not at the plugins list that status itself proves", () => {
    expect(connectionProblem("absent")!.next).toBe(
      "Retry in a few seconds; if it persists, check that no organisation policy (mcp.use) or other plugin removes the granola server, then restart OpenCode.",
    )
  })

  it("tells the user what to do when a Granola tool is missing for the account", () => {
    expect(toolUnavailable("get_meeting_transcript")).toMatchObject({
      code: "TOOL_UNAVAILABLE",
      message: "Granola does not offer get_meeting_transcript for this account.",
    })
  })
})

describe("error format", () => {
  it("gives every plugin error a unique code and exactly one next step, ending with a full stop", () => {
    const problems = [
      ...(["absent", "pending", "needs_auth", "failed", "disabled"] as const).map((state) => connectionProblem(state, "x")!),
      toolUnavailable("x"), invalidOption("x", "is wrong"), hostUntested(">=2.2.3 <2.3.0", "2.3.0"), STATUS_UNAVAILABLE,
      skillsInvalid("skills/x/SKILL.md"), packageInvalid("is broken"),
    ]
    expect(new Set(problems.map((problem) => problem.code)).size).toBe(problems.length)
    for (const problem of problems) {
      expect(problem.code).toMatch(/^[A-Z][A-Z_]+$/)
      expect(`${problem.message} ${problem.next}`, problem.code).not.toContain("`")
      expect(problem.next, problem.code).toMatch(/^[A-Z][^]*\.$/)
      expect(problem.next.replace(/`[^`]*`/g, "").replace(/\.$/, ""), problem.code).not.toMatch(/\. /)
    }
  })

  it("joins code, message and next step", () => {
    expect(describeProblem({ code: "CONNECTING", message: "Granola is still connecting.", next: "Retry in a few seconds." }))
      .toBe("CONNECTING: Granola is still connecting. Next step: Retry in a few seconds.")
  })

  it("throws setup failures as GranolaError carrying the code", () => {
    const error = new GranolaError(invalidOption("exportDir", "is not supported"))
    expect(error.code).toBe("OPTIONS_INVALID")
    expect(error.message).toBe("OPTIONS_INVALID: Plugin option exportDir is not supported. Next step: Fix the Granola plugin options in your OpenCode config, then reload OpenCode.")
  })

  it("returns model-facing failures as Tool.Error with the code and next step as metadata", () => {
    const error = toolError(connectionProblem("pending")!)
    expect(error).toBeInstanceOf(ToolError)
    expect(error.message).toBe("CONNECTING: Granola is still connecting. Next step: Retry in a few seconds.")
    expect(error.metadata).toEqual({ code: "CONNECTING", next: "Retry in a few seconds." })
  })

  it("states the tested line, the found version and the override", () => {
    expect(describeProblem(hostUntested(">=2.2.3 <2.3.0", "2.3.0"))).toBe(
      "HOST_UNTESTED: The Granola plugin supports OpenCode >=2.2.3 <2.3.0, found 2.3.0. Next step: Use OpenCode >=2.2.3 <2.3.0, or set the plugin option allowUntestedHost to true to run anyway.",
    )
  })
})
