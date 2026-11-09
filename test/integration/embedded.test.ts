// The host test on the public `@opencode/sdk` host, embedded in this process. `npm run test:host` runs it under Bun,
// which serves the vitest imports from bun:test; build first with `npm run build`, since OpenCode loads dist/.
import { afterAll, beforeAll, expect } from "vitest"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import { setTimeout as sleep } from "node:timers/promises"
import { startSyntheticGranola, type SyntheticGranola } from "../synthetic-granola/server.js"
import { startEmbedded, type Host } from "./harness.js"
import { hostSuite } from "./suite.js"

let fake: SyntheticGranola
let captured = ""
const model = createServer(async (request, response) => {
  if (request.url === "/api/v1/models") {
    response.writeHead(200, { "content-type": "application/json" })
    response.end(JSON.stringify({ models: [{ type: "llm", key: "budget-model", display_name: "Budget", loaded_instances: [], max_context_length: 32000, capabilities: { vision: false, trained_for_tool_use: true } }] }))
    return
  }
  let raw = ""
  for await (const chunk of request) raw += chunk
  const body = JSON.parse(raw) as { messages?: { role: string; content?: unknown }[] }
  const system = (body.messages ?? []).filter(m => m.role === "system").map(m => typeof m.content === "string" ? m.content : "").join("\n")
  if (system.includes("- granola (")) captured = system
  const chunk = (delta: object, finish: string | null) => `data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", created: 0, model: "budget-model", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
  response.writeHead(200, { "content-type": "text/event-stream" })
  response.end(`${chunk({ role: "assistant", content: "ok" }, null)}${chunk({}, "stop")}data: [DONE]\n\n`)
})
beforeAll(async () => {
  fake = await startSyntheticGranola()
  await new Promise<void>(resolve => model.listen(0, "127.0.0.1", resolve))
})
afterAll(async () => {
  await fake?.close()
  model.closeAllConnections()
  await new Promise<void>(resolve => model.close(() => resolve()))
})

hostSuite("embedded @opencode/sdk", (server) => startEmbedded(server, undefined, `http://127.0.0.1:${(model.address() as AddressInfo).port}/v1`), () => fake, async (host: Host) => {
    const location = host.location("main")
    for (const deadline = Date.now() + 60000;; await sleep(100)) {
      const state = (await host.client.rpc.call({ rpcID: "granola.test.probe", method: "state", input: {}, location })).output as { tools: { id: string }[] }
      if (state.tools.some(item => item.id === "granola_list_meetings")) break
      if (Date.now() > deadline) throw new Error("Granola tools did not register")
    }
    for (const deadline = Date.now() + 30000;; await sleep(100)) {
      const models = await host.client.model.list({ location })
      if (models.data.some(item => item.providerID === "lmstudio" && item.id === "budget-model")) break
      if (Date.now() > deadline) throw new Error("model did not register")
    }
    const session = await host.client.session.create({ location, agent: "build", model: { providerID: "lmstudio", id: "budget-model" } } as never)
    await host.client.session.prompt({ sessionID: session.id, text: "Reply with ok." } as never)
    for (const deadline = Date.now() + 30000; !captured && Date.now() < deadline; await sleep(100)) {}
    const lines = captured.split("\n"), start = lines.findIndex(line => line.startsWith("- granola ("))
    expect(start).toBeGreaterThanOrEqual(0)
    const section = [lines[start]!]
    for (let i = start + 1; i < lines.length && lines[i]!.startsWith("  "); i++) section.push(lines[i]!)
    expect(Math.round(section.join("\n").length / 4)).toBeLessThanOrEqual(1000)
})
