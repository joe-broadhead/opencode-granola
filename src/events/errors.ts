import { describe, shortReason, type Problem } from "../errors.js"

// events_list's and probe's failures, in the same code, message and next-step form as the connection errors. The codes
// are the source contract's own (`ERROR_CODES` in its `events` module), so a consumer reads them without a mapping.

/** A failure of events_list or probe. The tool shows it as a Tool.Error; the tools RPC as the script's code and next step. */
export class EventsFailure extends Error {
  constructor(readonly problem: Problem) {
    super(describe(problem))
    this.name = "EventsFailure"
  }
}

export function invalidInput(method: string, problems: readonly string[]): Problem {
  return {
    code: "INPUT_INVALID",
    message: `The ${method} input is invalid: ${shortReason(problems.join("; "))}.`,
    next: method === "probe"
      ? "Pass only source and account, as probe's schema describes."
      : "Pass account (the signed-in Granola email, as probe names it), and only since, cursor, limit (1 to 500) and source besides, as the tool's schema describes.",
  }
}

export function accountRequired(): Problem {
  return {
    code: "INPUT_INVALID",
    message: "A listing of Granola meetings names the account it reads, and this events_list call names none.",
    next: "Pass account, the signed-in Granola email that probe answers, with since or the previous result's cursor.",
  }
}

export function cursorInvalid(): Problem {
  return {
    code: "CURSOR_INVALID",
    message: "The cursor was not issued by Granola's events_list for this account.",
    next: "Pass a cursor from a previous result for the same account, or start again with since.",
  }
}

export function accountMismatch(account: string, why: "cursor" | "signed-in"): Problem {
  return why === "cursor"
    ? {
        code: "ACCOUNT_MISMATCH",
        message: `The cursor is for another Granola account than ${account}.`,
        next: "Pass the cursor with the account it was issued for, or start again for this account with since.",
      }
    : {
        code: "ACCOUNT_MISMATCH",
        message: `Granola is signed in to another account than ${account}.`,
        next: "Sign in to Granola as that account (/connect, Granola), or read as the account probe names.",
      }
}

export function sourceUnknown(): Problem {
  return {
    code: "SOURCE_UNKNOWN",
    message: "This plugin lists one source, granola.",
    next: 'Leave source out, or pass "granola".',
  }
}

export function ownerUnknown(): Problem {
  return {
    code: "UNAVAILABLE",
    message: "Granola did not name the signed-in account's email.",
    next: "Run /granola-status, and sign in to Granola again if it shows a problem.",
  }
}

export function readFailed(tool: string, reason: string, method: string): Problem {
  return {
    code: "UNAVAILABLE",
    message: `Granola's ${tool} failed: ${shortReason(reason)}.`,
    next: `Call ${method} again${method === "events_list" ? " with the same cursor" : ""}; if it keeps failing, run /granola-status.`,
  }
}
