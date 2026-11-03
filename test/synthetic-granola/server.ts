// A loopback stand-in for Granola's MCP server, for the host test. It speaks Streamable HTTP and answers in
// Server-Sent Events. The host test routes https://mcp.granola.ai/mcp to one of its routes, so nothing reaches
// Granola. The routes give the connection states:
// - /connected/mcp serves Granola's tools;
// - /needs-auth/mcp answers 401 with OAuth metadata, so OpenCode reports that sign-in is needed;
// - /pending/mcp never answers, so the connection stays pending.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"

export type Route = "connected" | "needs-auth" | "pending"

/** Tool names by how the plugin treats them. `brand_new_tool` stands in for a tool this plugin version does not know. */
export const TOOLS = {
  read: ["get_account_info", "list_meetings", "get_meetings", "get_meeting_transcript", "search_transcripts"],
  write: ["create_folder", "update_folder", "add_note_to_folder", "remove_note_from_folder"],
  hidden: ["sign_out"],
  unknown: ["brand_new_tool"],
} as const

/** The server's display title, which OpenCode shows once connected. */
export const TITLE = "Granola (synthetic)"
export const WORKSPACE = "Synthetic workspace"
/** The only meeting the server knows. */
export const MEETING = "m-1"
/** A meeting whose transcript the server refuses with Granola's plan error, as on a free plan. */
export const PLAN_LIMITED = "m-free"
/** A meeting whose transcript read fails with UPSTREAM_FAILURE. */
export const FAILING = "m-fail"
/** Granola's error for FAILING: two lines, the first with a signed URL. */
export const UPSTREAM_FAILURE = "Transcript storage refused https://files.example.invalid/t.json?X-Amz-Signature=fake-signature-123\nTraceback: second line"

export interface Call {
  readonly tool: string
  readonly args: Record<string, unknown>
}

export interface SyntheticGranola {
  /** The MCP endpoint of a route, on 127.0.0.1. */
  url(route: Route): string
  /** Every tools/call the connected route received, in order. */
  readonly calls: Call[]
  close(): Promise<void>
}

type Message = { jsonrpc: "2.0"; id?: number | string; method: string; params?: { protocolVersion?: string; name?: string; arguments?: Record<string, unknown> } }

const object = (properties: Record<string, unknown> = {}) => ({ type: "object", properties })
const READ = { readOnlyHint: true, destructiveHint: false }
const WRITE = { readOnlyHint: false, destructiveHint: true }
const SCHEMAS: Record<string, object> = {
  get_account_info: object(),
  list_meetings: object({ limit: { type: "integer", minimum: 1 } }),
  get_meetings: object({ meeting_ids: { type: "array", items: { type: "string" }, maxItems: 10 } }),
  get_meeting_transcript: object({ meeting_id: { type: "string" }, offset: { type: "integer", minimum: 0 }, max_chars: { type: "integer", minimum: 1000 } }),
  search_transcripts: object({ keywords: { type: "array", items: { type: "string" } }, limit: { type: "integer", minimum: 1 } }),
  create_folder: object({ title: { type: "string" } }),
  update_folder: object({ folder_id: { type: "string" }, title: { type: "string" } }),
  add_note_to_folder: object({ folder_id: { type: "string" }, note_id: { type: "string" } }),
  remove_note_from_folder: object({ folder_id: { type: "string" }, note_id: { type: "string" } }),
  sign_out: object(),
  brand_new_tool: object(),
}
const LISTED = [...TOOLS.read, ...TOOLS.write, ...TOOLS.hidden, ...TOOLS.unknown].map((name) => ({
  name,
  description: `${name.replaceAll("_", " ")} (synthetic)`,
  inputSchema: SCHEMAS[name],
  ...((TOOLS.read as readonly string[]).includes(name) ? { annotations: READ } : (TOOLS.unknown as readonly string[]).includes(name) ? {} : { annotations: WRITE }),
}))

/** The rest of the reply to initialize. */
const SERVER_INFO = {
  capabilities: { tools: { listChanged: false } },
  serverInfo: { name: "granola-synthetic", title: TITLE, version: "0.0.0" },
}

const TRANSCRIPT = ["Speaker A: Welcome to the weekly sync.", "Speaker B: The export ships this week.", "Speaker A: Thanks, see you next week."].join("\n")

const text = (value: unknown) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }] })

/** Granola's get_meetings markup for the one meeting it knows; for none of them, only a <not_found_hint>, as Granola does. */
function meetings(ids: readonly string[]): string {
  const found = ids.filter((id) => id === MEETING)
  if (!found.length) return "<not_found_hint>\nNo meeting matches the requested IDs. Check them with list_meetings or search_meetings.\n</not_found_hint>"
  const body = found.map((id) => [
    `<meeting id="${id}" title="Weekly sync" meeting_at="2026-10-28T10:00:00Z" url="https://notes.example.test/d/${id}">`,
    `<known_participants total="1"><participant name="Ada" /></known_participants>`,
    `<summary>### Decisions\n- Ship the export</summary>`,
    `<private_notes>Follow up next week.</private_notes>`,
    `</meeting>`,
  ].join("\n"))
  return [`<meetings_data count="${found.length}">`, ...body, `</meetings_data>`].join("\n")
}

function call(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "get_account_info":
      return text({ active_workspace: { id: "w-1", display_name: WORKSPACE } })
    case "list_meetings":
      return text({ meetings: [{ id: MEETING, title: "Weekly sync" }] })
    case "get_meetings":
      return text(meetings(Array.isArray(args.meeting_ids) ? args.meeting_ids.map(String) : []))
    case "get_meeting_transcript": {
      if (args.meeting_id === FAILING) return { isError: true, ...text(UPSTREAM_FAILURE) }
      if (args.meeting_id === PLAN_LIMITED) return { isError: true, ...text("Transcripts are only available to paid Granola tiers. Do not retry unless the plan changes.") }
      if (args.meeting_id !== MEETING) return { isError: true, ...text("Meeting not found") }
      const value = { meeting_id: MEETING, title: "Weekly sync", transcript: TRANSCRIPT, total_chars: TRANSCRIPT.length, truncated: false }
      return { ...text(value), structuredContent: value }
    }
    default:
      return LISTED.some((tool) => tool.name === name) ? text({ ok: true }) : { isError: true, ...text(`Unknown tool ${name}`) }
  }
}

function answer(message: Message, calls: Call[]) {
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: message.id, result })
  switch (message.method) {
    case "initialize":
      return reply({ protocolVersion: message.params?.protocolVersion, ...SERVER_INFO })
    case "tools/list":
      return reply({ tools: LISTED })
    case "tools/call": {
      const name = message.params?.name ?? ""
      const args = message.params?.arguments ?? {}
      calls.push({ tool: name, args })
      return reply(call(name, args))
    }
    case "ping":
      return reply({})
    default:
      return { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } }
  }
}

async function read(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString("utf8")
}

export async function startSyntheticGranola(): Promise<SyntheticGranola> {
  const calls: Call[] = []
  const held = new Set<ServerResponse>()
  let base = ""

  const json = (response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) =>
    void response.writeHead(status, { "content-type": "application/json", ...headers }).end(JSON.stringify(body))

  const server = createServer(async (request, response) => {
    // A fresh connection per request: reusing one the server is closing as idle fails with ECONNRESET.
    response.setHeader("connection", "close")
    const path = new URL(request.url ?? "/", base).pathname
    if (path.startsWith("/.well-known/oauth-protected-resource")) {
      return json(response, 200, { resource: `${base}/needs-auth/mcp`, authorization_servers: [`${base}/needs-auth`] })
    }
    if (path.startsWith("/.well-known/oauth-authorization-server") || path.startsWith("/.well-known/openid-configuration")) {
      return json(response, 200, {
        issuer: `${base}/needs-auth`,
        authorization_endpoint: `${base}/needs-auth/authorize`,
        token_endpoint: `${base}/needs-auth/token`,
        registration_endpoint: `${base}/needs-auth/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      })
    }
    if (path.startsWith("/needs-auth/")) {
      return json(response, 401, { error: "invalid_token" }, { "www-authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/needs-auth/mcp"` })
    }
    if (path === "/pending/mcp") {
      held.add(response)
      response.once("close", () => held.delete(response))
      return
    }
    if (path !== "/connected/mcp") return void response.writeHead(404).end()
    if (request.method === "DELETE") return void response.writeHead(200).end()
    if (request.method !== "POST") return void response.writeHead(405, { allow: "POST, DELETE" }).end()
    const message = JSON.parse(await read(request)) as Message
    // A notification has no id; JSON-RPC id 0 is still a request.
    if (message.id === undefined) return void response.writeHead(202).end()
    response
      .writeHead(200, { "content-type": "text/event-stream", "mcp-session-id": "synthetic-session" })
      .end(`event: message\ndata: ${JSON.stringify(answer(message, calls))}\n\n`)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`

  return {
    url: (route) => `${base}/${route}/mcp`,
    calls,
    close: () => new Promise<void>((resolve) => {
      for (const response of held) response.destroy()
      server.closeAllConnections()
      server.close(() => resolve())
    }),
  }
}
