/**
 * The OpenCode releases every check runs on: the one list of tested releases. Status calls only these tested; another
 * release inside the supported range (`opencode.host` in package.json) still runs. The host and pack tests read it too.
 */
export const TESTED_HOSTS: readonly string[] = ["2.2.3", "2.2.4", "2.2.5", "2.2.6"]
