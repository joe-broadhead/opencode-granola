// Which tarball the pack stage tests. The release workflow packs the tag, and scripts/release-pack.mjs runs this stage
// with that file as PACK_TARBALL, so the release's own bytes are tested. A local run may name a tarball with --tarball,
// which takes precedence. With neither, the stage builds and packs the repository itself.
import { resolve } from "node:path"

/** The absolute path of the tarball the stage must test, or undefined when the stage packs the repository itself. */
export function givenTarball(argv: readonly string[], env: Readonly<Record<string, string | undefined>>): string | undefined {
  const flag = argv.indexOf("--tarball")
  if (flag !== -1) {
    const named = argv[flag + 1]
    if (named === undefined || named === "") throw new Error("--tarball needs a path")
    return resolve(named)
  }
  const fromEnv = env.PACK_TARBALL
  return fromEnv !== undefined && fromEnv.trim() !== "" ? resolve(fromEnv) : undefined
}
