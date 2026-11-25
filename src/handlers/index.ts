/**
 * The handler table: one entry per method the manifest declares, by the method's name.
 *
 * A handler says what one method looks like and does the work; `register` adds the account selector, the doors, the
 * permission assertions and the answer checks. The provider is the only layer that talks to Granola.
 */
import type { AccountProfile } from "@we-the-rebel-alliance/plugin-contract/accounts"
import type { Manifest } from "@we-the-rebel-alliance/plugin-contract/manifest"
import type { HandlerTable } from "@we-the-rebel-alliance/plugin-contract/register"
import { eventsListHandler } from "./events-list.ts"
import { exportMarkdownHandler } from "./export-markdown.ts"
import { probeHandler } from "./probe.ts"
import { statusHandler } from "./status.ts"
import type { Provider } from "../provider/client.ts"

/** The plugin state the handlers may read, built once in `setup`. */
export interface HandlerRuntime {
  /** The validated manifest, for `status`. */
  readonly manifest: Manifest
  /** The installed package name, which a page states. */
  readonly packageName: string
  /** The package version, which `status` reports. */
  readonly version: string
  /** The OpenCode release the plugin runs on. */
  readonly hostVersion: string
  /** The accounts the options declare, in their order. */
  readonly accounts: readonly AccountProfile[]
  /** What registering the accounts could not do, for `status`. */
  readonly accountProblems: readonly string[]
  /** The export folder, absolute and expanded. */
  readonly exportDirectory: string
  readonly provider: Provider
  /** The clock a page's `asOf` is stamped with; tests pass a fixed one. */
  readonly clock: () => number
}

/** Every method's handler. */
export function handlersFor(runtime: HandlerRuntime): HandlerTable {
  return {
    status: statusHandler(runtime),
    probe: probeHandler(runtime),
    events_list: eventsListHandler(runtime),
    export_markdown: exportMarkdownHandler(runtime),
  }
}
