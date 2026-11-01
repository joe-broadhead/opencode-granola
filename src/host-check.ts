import { GranolaError, hostUntested, packageInvalid } from "./errors.js"

export interface HostCheck {
  readonly version: string
  readonly tested: string
  /** Set only when allowUntestedHost let an untested OpenCode version load the plugin. */
  readonly warning?: string
}

type Triple = readonly [number, number, number]

function triple(text: string): Triple | undefined {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(text)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined
}

function compare(left: Triple, right: Triple): number {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2]
}

/**
 * True when a release version satisfies every comparator of the range, for example ">=2.2.3 <2.3.0".
 * Prerelease and dev builds such as 0.0.0-dev-202610301200 never count as tested.
 */
export function satisfies(version: string, range: string): boolean {
  const comparators = range.trim().split(/\s+/).map((part) => {
    const match = /^(>=|<=|>|<|=)?(.+)$/.exec(part)
    const bound = match && triple(match[2]!)
    if (!match || !bound) throw new GranolaError(packageInvalid(`has an invalid opencode.host range: ${range}`))
    return { operator: match[1] ?? "=", bound }
  })
  const current = triple(version.trim())
  if (!current) return false
  return comparators.every(({ operator, bound }) => {
    const order = compare(current, bound)
    if (operator === ">=") return order >= 0
    if (operator === "<=") return order <= 0
    if (operator === ">") return order > 0
    if (operator === "<") return order < 0
    return order === 0
  })
}

/** Refuses an untested OpenCode version unless the user opted in with allowUntestedHost. */
export function checkHost(version: string, tested: string, allowUntested: boolean): HostCheck {
  if (satisfies(version, tested)) return { version, tested }
  if (!allowUntested) throw new GranolaError(hostUntested(tested, version))
  return {
    version,
    tested,
    warning: `outside the tested line ${tested}; it runs because allowUntestedHost is true`,
  }
}
