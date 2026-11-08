import { describe, shortReason, type Problem } from "../errors.js"

// events_list's failures, in the same code, message and next-step form as the connection errors.

/** A failure of events_list. The tool shows it as a Tool.Error; the tools RPC as the script's code and next step. */
export class EventsFailure extends Error {
  constructor(readonly problem: Problem) {
    super(describe(problem))
    this.name = "EventsFailure"
  }
}

export function invalidInput(problems: readonly string[]): Problem {
  return {
    code: "EVENTS_INVALID_INPUT",
    message: `The events_list input is invalid: ${shortReason(problems.join("; "))}.`,
    next: "Pass only since, cursor, limit (1 to 500), account and source, as the tool's schema describes.",
  }
}

export function cursorInvalid(): Problem {
  return {
    code: "EVENTS_CURSOR_INVALID",
    message: "The cursor was not issued by Granola's events_list for this account and its signed-in user.",
    next: "Pass a cursor from a previous result of the same account, or start again with since.",
  }
}

export function accountUnknown(): Problem {
  return {
    code: "EVENTS_ACCOUNT_UNKNOWN",
    message: "Granola has one account, default.",
    next: 'Leave account out, or pass "default".',
  }
}

export function sourceUnknown(): Problem {
  return {
    code: "EVENTS_SOURCE_UNKNOWN",
    message: "This plugin lists one source, granola.",
    next: 'Leave source out, or pass "granola".',
  }
}

export function ownerUnknown(): Problem {
  return {
    code: "EVENTS_OWNER_UNKNOWN",
    message: "Granola did not name the signed-in account's email.",
    next: "Run /granola-status, and sign in to Granola again if it shows a problem.",
  }
}

export function readFailed(tool: string, reason: string): Problem {
  return {
    code: "EVENTS_READ_FAILED",
    message: `Granola's ${tool} failed: ${shortReason(reason)}.`,
    next: "Call events_list again with the same cursor; if it keeps failing, run /granola-status.",
  }
}
