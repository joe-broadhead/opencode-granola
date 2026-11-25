import assert from "node:assert/strict"
import { test } from "node:test"
import { accountsOf, registerAccounts, resolveAccount } from "@we-the-rebel-alliance/plugin-contract/accounts"
import { manifest } from "../src/manifest.ts"
import { MCP_URL } from "../src/provider/client.ts"

/** The transforms registration needs, recording the MCP servers it sets. */
function fakeContext(): { context: { integration: { transform: (callback: (editor: unknown) => void) => Promise<unknown> }; mcp: { transform: (callback: (editor: unknown) => void) => Promise<unknown> } }; servers: Map<string, unknown> } {
  const servers = new Map<string, unknown>()
  return {
    servers,
    context: {
      integration: { transform: async () => undefined },
      mcp: {
        transform: async (callback) =>
          callback({
            set: (name: string, config: unknown) => void servers.set(name, config),
          }),
      },
    },
  }
}

test("one MCP server per alias, named granola and granola-<alias>", async () => {
  const { context, servers } = fakeContext()
  const registration = await registerAccounts(context, {
    manifest,
    options: { accounts: { work: {}, personal: {} } },
    server: (_account, _name) => ({ type: "remote", url: MCP_URL, oauth: {} }),
  })
  assert.deepEqual(registration.problems, [])
  assert.deepEqual([...servers.keys()].sort(), ["granola-personal", "granola-work"])
  for (const config of servers.values()) assert.deepEqual(config, { type: "remote", url: MCP_URL, oauth: {} })
  assert.deepEqual(registration.accounts.map((account) => account.name).sort(), ["granola-personal", "granola-work"])
})

test("with no accounts option there is one default alias and one granola server", async () => {
  const { context, servers } = fakeContext()
  const registration = await registerAccounts(context, {
    manifest,
    options: {},
    server: (_account, _name) => ({ type: "remote", url: MCP_URL, oauth: {} }),
  })
  assert.deepEqual(registration.accounts, [{ alias: "default", name: "granola" }])
  assert.deepEqual([...servers.keys()], ["granola"])
})

test("an alias outside the contract's rule is refused before anything is registered", () => {
  const plan = accountsOf(manifest, { accounts: { Work: {} } })
  assert.equal(plan.ok, false)
  if (!plan.ok) assert.match(plan.problems.join("; "), /Work/)
})

test("the profile schema is closed: a field a profile does not declare is refused", () => {
  const plan = accountsOf(manifest, { accounts: { work: { region: "eu" } } })
  assert.equal(plan.ok, false)
  if (!plan.ok) assert.match(plan.problems.join("; "), /region/)
})

test("missing and unknown aliases answer the contract's codes", () => {
  const plan = accountsOf(manifest, { accounts: { work: {}, personal: {} } })
  assert.equal(plan.ok, true)
  if (!plan.ok) return
  const missing = resolveAccount(plan.value.accounts, {})
  assert.equal(missing.ok, false)
  if (!missing.ok) {
    assert.equal(missing.code, "ACCOUNT_REQUIRED")
    assert.match(missing.next, /work, personal/)
  }
  const unknown = resolveAccount(plan.value.accounts, { account: "nobodyhere" })
  assert.equal(unknown.ok, false)
  if (!unknown.ok) {
    assert.equal(unknown.code, "ACCOUNT_UNKNOWN")
    assert.match(unknown.next, /work, personal/)
  }
  const work = resolveAccount(plan.value.accounts, { account: "work" })
  assert.deepEqual(work, { ok: true, alias: "work" })
})
