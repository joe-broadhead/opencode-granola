/**
 * The built bundle in the real OpenCode 2.4.1 host, through the installed `@opencode/sdk`.
 *
 * Proves the skills this repository ships are registered after load (the contract's `register` does not register
 * them), that every declared method still reaches every agent's rules, and that sign-in and status keep the
 * surfaces the last pre-4b release had.
 */
import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join, sep } from "node:path"
import { test, after, before } from "node:test"
import { fileURLToPath } from "node:url"
import { parse } from "yaml"
import { manifest } from "../../src/manifest.ts"
import { REPO, startHost, type Host } from "../support/host.ts"

const SKILLS = fileURLToPath(new URL("../../skills/", import.meta.url))
const ALIASES = ["default", "work"] as const
const SERVERS = ALIASES.map((alias) => (alias === "default" ? manifest.plugin.name : `${manifest.plugin.name}-${alias}`))

/** The skills the package ships, read from the files themselves: the front matter's name must be the directory. */
function expectedSkills(): { id: string; description: string }[] {
  return readdirSync(SKILLS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((id) => {
      const text = readFileSync(join(SKILLS, id, "SKILL.md"), "utf8")
      const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text)?.[1]
      assert.ok(front !== undefined, `skills/${id}/SKILL.md has front matter`)
      const fields = parse(front) as { name?: unknown; description?: unknown }
      assert.equal(fields.name, id)
      assert.equal(typeof fields.description, "string", `skills/${id}/SKILL.md has a description`)
      const description = (fields.description as string).trim()
      assert.notEqual(description, "", `skills/${id}/SKILL.md has a non-empty description`)
      assert.doesNotMatch(description, /^[>|][+-]?\d*$/, `skills/${id}/SKILL.md has a real description, not a block marker`)
      return { id, description }
    })
}

/** Every permission action the manifest declares: `<name>.<method>`, and one MCP tool per alias. */
function expectedActions(): string[] {
  const actions: string[] = []
  for (const method of Object.keys(manifest.methods)) {
    if (method.startsWith("mcp:")) {
      for (const server of SERVERS) actions.push(`${server}_${method.slice("mcp:".length)}`)
    } else {
      actions.push(`${manifest.plugin.name}.${method}`)
    }
  }
  return actions
}

let host: Host | undefined
before(async () => {
  // Two aliases prove the per-alias sign-in servers without a network.
  host = await startHost(manifest.plugin.name, { accounts: { default: {}, work: {} } })
})
after(async () => {
  await host?.close()
})

test("every bundled skill is registered after the plugin loads in OpenCode 2.4.1", async () => {
  assert.ok(host !== undefined)
  // OpenCode discovers <project>/skills itself, so the project must be an empty temp directory: only the plugin's
  // own registration can make these ids appear.
  assert.equal(host.location.directory.startsWith(REPO + sep), false)
  assert.equal(existsSync(join(host.location.directory, "skills")), false)
  const expected = expectedSkills()
  assert.deepEqual(
    expected.map((skill) => skill.id),
    ["granola", "granola-meeting-brief"],
  )
  const listed = (await host.client.skill.list({ location: host.location })).data
  for (const skill of expected) {
    const found = listed.find((entry) => entry.id === skill.id)
    assert.ok(found !== undefined, `${skill.id} is registered: ${listed.map((entry) => entry.id).join(", ")}`)
    assert.equal(found.name, skill.id)
    assert.equal(found.description, skill.description)
    assert.notEqual(found.description.trim(), "", `${skill.id} has a non-empty description`)
    assert.doesNotMatch(found.description, /^[>|][+-]?\d*$/, `${skill.id} has a real description, not a block marker`)
    assert.ok(found.path.endsWith(`skills/${skill.id}/SKILL.md`), found.path)
    assert.ok(found.content !== "")
  }
})

test("every declared method still reaches every agent's rules", async () => {
  assert.ok(host !== undefined)
  const expected = expectedActions()
  assert.equal(expected.length, 4 + 20 * SERVERS.length)
  const agents = (await host.client.agent.list({ location: host.location })).data
  assert.ok(agents.length > 0)
  for (const agent of agents) {
    // The old default block was inserted after an agent's base allow; agents without one were left unchanged.
    if (!agent.permissions.some((rule) => rule.action === "*" && rule.resource === "*" && rule.effect === "allow")) continue
    const actions = new Set(agent.permissions.map((rule) => rule.action))
    assert.deepEqual(
      expected.filter((action) => !actions.has(action)),
      [],
      `${agent.id} holds every declared action`,
    )
    // v0.0.10 also hid sign_out and never exposed it; the rewrite leaves it out of the manifest, so no rule names it.
    for (const server of SERVERS) assert.equal(actions.has(`${server}_sign_out`), false, `${agent.id} has no sign_out`)
  }
})

test("registers one MCP server per account on the real host", async () => {
  assert.ok(host !== undefined)
  const servers = (await host.client.mcp.list({ location: host.location })).data.map((entry) => entry.name)
  assert.deepEqual(
    servers.filter((name) => name === manifest.plugin.name || name.startsWith(`${manifest.plugin.name}-`)).sort(),
    [...SERVERS].sort(),
  )
})

test("sign-in and status keep their pre-4b surfaces", async () => {
  assert.ok(host !== undefined)
  const session = await host.client.sessions.create({ location: host.location, agent: "build", permissions: [] })
  const status = (
    await host.client.rpc.call({ rpcID: manifest.plugin.name, method: "status", input: { sessionID: session.id, input: {} }, location: host.location })
  ).output as {
    name: string
    version: string
    host: { version: string; range: string }
    accounts: { alias: string }[]
    unguardedAgents: string[]
  }
  assert.equal(status.name, manifest.plugin.name)
  assert.equal(status.version, "0.0.11")
  assert.equal(status.host.version, "2.4.1")
  assert.deepEqual(
    status.accounts.map((account) => account.alias),
    [...ALIASES],
  )
  assert.deepEqual(status.unguardedAgents, [])
  // probe is still an RPC read, and an alias the options do not declare is still refused before any network call.
  await assert.rejects(
    host.client.rpc.call({ rpcID: manifest.plugin.name, method: "probe", input: { sessionID: session.id, input: { account: "missing" } }, location: host.location }),
    (error: unknown) => {
      assert.equal((error as { data?: { code?: string } }).data?.code, "ACCOUNT_UNKNOWN")
      return true
    },
  )
})
