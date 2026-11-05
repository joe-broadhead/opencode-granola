import { shortReason, type Problem } from "../errors.js"

// The export's failures, in the same code, message and next-step form as the connection errors.

export function invalidInput(problem: string): Problem {
  return {
    code: "EXPORT_INVALID_INPUT",
    message: `The export request ${problem}.`,
    next: "Pass meeting_ids (1 to 20 meeting IDs) and content (notes, transcript or both).",
  }
}

export function invalidPath(path: string, problem: string): Problem {
  return {
    code: "EXPORT_INVALID_PATH",
    message: `The export path \`${shortReason(path)}\` ${problem}.`,
    next: "Use a path inside the export folder, such as `meetings/weekly-sync.md`, without `..`, a leading `/` or links.",
  }
}

export function exists(path: string): Problem {
  return {
    code: "EXPORT_EXISTS",
    message: `\`${path}\` already exists in the export folder.`,
    next: "Choose another path, or ask the user before you export again with overwrite: true.",
  }
}

export function tooLarge(maxBytes: number): Problem {
  return {
    code: "EXPORT_TOO_LARGE",
    message: `The export is larger than its ${size(maxBytes)} limit.`,
    next: "Export fewer meetings at a time.",
  }
}

export function readFailed(what: "notes" | "transcript", meetingID: string, reason: string): Problem {
  return {
    code: "EXPORT_READ_FAILED",
    message: `Granola could not return the ${what} of meeting \`${shortReason(meetingID)}\`: ${shortReason(reason)}. Nothing was written.`,
    next: "Export again without that meeting.",
  }
}

export function writeFailed(path: string, reason: string): Problem {
  return {
    code: "EXPORT_WRITE_FAILED",
    message: `Could not write \`${path}\` in the export folder: ${reason}.`,
    next: "Make sure the export folder that /granola-status shows is writable and has free space, then export again.",
  }
}

export function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`
  return `${Math.round(bytes / 104857.6) / 10} MB`
}
