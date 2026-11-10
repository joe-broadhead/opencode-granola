// The brief skill decides where an upcoming-meeting question starts. When the user names their Granola notes, the
// calendar gives only the event, and the answer comes from Granola's earlier meetings with those attendees.
import { describe, expect, test } from "vitest"
import { readFileSync } from "node:fs"

const skill = readFileSync(new URL("../skills/granola-meeting-brief/SKILL.md", import.meta.url), "utf8").replace(/\r\n/g, "\n")

describe("granola-meeting-brief routing for an upcoming meeting", () => {
  test("a named Granola source reads the calendar only for the event, then searches Granola", () => {
    expect(skill).toContain(
      "When the user names their Granola notes, read the calendar only for that event's title, time and attendees, then search Granola for those attendees' earlier meetings before you answer.",
    )
  })

  test("a past Granola meeting is never presented as the upcoming one", () => {
    expect(skill).toContain("Never present a past Granola meeting as the upcoming one.")
  })
})
