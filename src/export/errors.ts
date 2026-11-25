/** The export's failures, in the contract's one `CODE: What happened. Next step: What to do.` form. */
import { SourceError } from "@we-the-rebel-alliance/plugin-contract/events"

/** A size a person reads, in bytes, KB or MB. */
export function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`
  return `${Math.round(bytes / 104857.6) / 10} MB`
}

/** A request the export's own checks refuse, beyond the method's JSON Schema. */
export function invalidInput(what: string, next: string): SourceError {
  return new SourceError({ code: "INPUT_INVALID", what, next })
}

/** A path outside the export folder, through a link, or over a file. */
export function invalidPath(path: string, problem: string): SourceError {
  return invalidInput(
    `the export path \`${path}\` ${problem}`,
    "Use a path inside the export folder, such as `meetings/weekly-sync.md`, without `..`, a leading `/` or links.",
  )
}

/** The target exists and `overwrite` is false. */
export function exists(path: string): SourceError {
  return invalidInput(`\`${path}\` already exists in the export folder`, "Choose another path, or ask the user before exporting again with overwrite: true.")
}

/** The whole file would exceed the export's limit. */
export function tooLarge(maxBytes: number): SourceError {
  return new SourceError({
    code: "TOO_LARGE",
    what: `the export is larger than its ${size(maxBytes)} limit`,
    next: "Export fewer meetings at a time.",
  })
}

/** A provider read the export needed failed. */
export function readFailed(what: "notes" | "transcript", meetingID: string, reason: string): SourceError {
  return new SourceError({
    code: "UNAVAILABLE",
    what: `Granola could not return the ${what} of meeting \`${meetingID}\`: ${reason}`,
    next: "Export again without that meeting, or try again when Granola answers.",
  })
}

/** The file could not be written. */
export function writeFailed(path: string, reason: string): SourceError {
  return new SourceError({
    code: "UNAVAILABLE",
    what: `could not write \`${path}\` in the export folder: ${reason}`,
    next: "Make sure the export folder is writable and has free space, then export again.",
  })
}
