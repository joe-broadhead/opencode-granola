import { GranolaError, hostUntested, packageInvalid } from "./errors.js"
import { TESTED_HOSTS } from "./hosts.js"

export interface HostCheck {
  readonly version: string
  /** The supported range, from package.json#opencode.host. */
  readonly range: string
  /** True only for a release in TESTED_HOSTS. */
  readonly tested: boolean
  /** Set only when allowUntestedHost let a version outside the supported range load the plugin. */
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
 * Prerelease and dev builds such as 0.0.0-dev-202610301200 are never inside it.
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

/**
 * Refuses an OpenCode version outside the supported range unless the user opted in with allowUntestedHost. Inside
 * the range, a release that is not in TESTED_HOSTS runs, and status calls it untested.
 */
export function checkHost(version: string, range: string, allowUntested: boolean): HostCheck {
  const tested = TESTED_HOSTS.includes(version)
  if (satisfies(version, range)) return { version, range, tested }
  if (!allowUntested) throw new GranolaError(hostUntested(range, version))
  return { version, range, tested, warning: `outside the supported range ${range}; it runs because allowUntestedHost is true` }
}
