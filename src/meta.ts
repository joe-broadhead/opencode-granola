import { readFileSync } from "node:fs"
import { GranolaError, packageInvalid } from "./errors.js"

/** Stable: plugin storage and diagnostics are keyed by it. */
export const PLUGIN_ID = "granola.meetings"

interface PackageInfo {
  readonly version: string
  /** The supported OpenCode range, from package.json#opencode.host. */
  readonly hostRange: string
}

/** package.json sits next to src/ and dist/ in the repository and in the installed package. */
export function readPackageInfo(url: URL = new URL("../package.json", import.meta.url)): PackageInfo {
  const raw: unknown = JSON.parse(readFileSync(url, "utf8"))
  const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null
  if (!record(raw) || typeof raw.version !== "string" || !record(raw.opencode) || typeof raw.opencode.host !== "string") {
    throw new GranolaError(packageInvalid("needs a version and an opencode.host range"))
  }
  return { version: raw.version, hostRange: raw.opencode.host }
}
