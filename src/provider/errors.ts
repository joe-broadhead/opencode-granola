/** The refusals the meetings domain raises, in the contract's one form. */
import { SourceError } from "@we-the-rebel-alliance/plugin-contract/events"

/** A source the plugin does not have. */
export function sourceUnknown(source: string): SourceError {
  return new SourceError({
    code: "SOURCE_UNKNOWN",
    what: `${source} is not a source of granola`,
    next: "Read the granola meetings source, or omit source.",
  })
}

/** A cursor another account, source or scope issued, or one that is malformed. */
export function cursorInvalid(): SourceError {
  return new SourceError({
    code: "CURSOR_INVALID",
    what: "the cursor belongs to another plugin, source, account or scope, or it is malformed",
    next: "Read again without the cursor to start a fresh window.",
  })
}

/** A get_meetings answer held meetings but named no signed-in account. */
export function accountUnnamed(alias: string): SourceError {
  return new SourceError({
    code: "UNAVAILABLE",
    what: `Granola returned meetings for ${alias} without naming the signed-in account`,
    next: "Sign the account in again through OpenCode, then retry.",
  })
}
