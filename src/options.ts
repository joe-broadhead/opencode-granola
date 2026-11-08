import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import { GranolaError, invalidOption } from "./errors.js"
import { ACCESS_VALUES, type Access } from "./rpc/contract.js"

export { ACCESS_VALUES, type Access }

export interface Options {
  /** Absolute directory for Markdown exports; created on the first approved export. */
  readonly exportDirectory: string
  /** Run outside the tested OpenCode line, with a status warning. */
  readonly allowUntestedHost: boolean
  /** What the generated default rules allow: everything, changes ask, or read-only. */
  readonly access: Access
}

const KEYS = ["exportDirectory", "allowUntestedHost", "access"] as const

/** Strict: an unknown key or a wrong type fails setup with one error that names the key. */
export function parseOptions(raw: unknown, home: string = homedir()): Options {
  if (raw === undefined || raw === null) return { exportDirectory: join(home, "Granola"), allowUntestedHost: false, access: "all" }
  if (typeof raw !== "object" || Array.isArray(raw)) throw new GranolaError(invalidOption("options", "must be an object"))
  const options = raw as Record<string, unknown>
  const unknown = Object.keys(options).find((key) => !(KEYS as readonly string[]).includes(key))
  if (unknown !== undefined) throw new GranolaError(invalidOption(unknown, `is not supported; use ${KEYS.join(", ")}`))

  const directory = options.exportDirectory
  if (directory !== undefined && (typeof directory !== "string" || !isAbsolute(directory) || directory.includes("\0"))) {
    throw new GranolaError(invalidOption("exportDirectory", "must be an absolute path (expand ~ yourself)"))
  }
  const untested = options.allowUntestedHost
  if (untested !== undefined && typeof untested !== "boolean") {
    throw new GranolaError(invalidOption("allowUntestedHost", "must be true or false"))
  }
  const access = options.access
  if (access !== undefined && (typeof access !== "string" || !(ACCESS_VALUES as readonly string[]).includes(access))) {
    throw new GranolaError(invalidOption("access", `must be "all" (the default), "ask-changes" or "read-only"`))
  }
  return {
    exportDirectory: directory === undefined ? join(home, "Granola") : resolve(directory),
    allowUntestedHost: untested ?? false,
    access: (access as Access | undefined) ?? "all",
  }
}
