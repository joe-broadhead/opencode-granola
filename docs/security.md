# Security

## What leaves the machine

The plugin has no HTTP client and no credential of its own. Every Granola call goes through the remote MCP server that
OpenCode registered for the alias, with the OAuth session OpenCode holds. What leaves the machine is the request
OpenCode makes to `https://mcp.granola.ai/mcp`: the tool name and the arguments the person or agent asked for. The
plugin writes nothing else and sends nothing to another host.

`export_markdown` writes a local Markdown file under `exportDirectory` (default `~/Granola`). The text never goes back
through the model: the handler reads the meetings and writes the file itself.

## Credentials

OpenCode owns sign-in and stores the token. The plugin never reads, prints or stores a token, a refresh token or a
password. Each alias is a separate MCP server (`granola`, `granola-work`), so OpenCode keys OAuth per alias and one
alias's session never reaches another's tools.

## Scopes

The plugin requests no OpenCode scope of its own. Granola's MCP OAuth scopes are the vendor's; `probe` reports the
note-access scopes the connection holds (`mcp_note_access.scopes`), so a person can tell a narrow sign-in from a wider
one. A missing scope is the provider's `NEEDS_SIGN_IN` or a vendor refusal, mapped to the contract's codes.

## Untrusted data

Every answer is marked `trust: "untrusted"`. Meeting titles, summaries and transcripts are data: the plugin never
follows them, never puts them in `status`, and never uses them to choose a tool or a recipient. Each event passes
through the contract's `screenEvents`, which refuses an item that holds a secret (`refused[]`, reason `secret`). The
list snapshot drops a title that holds a secret. A refused item is never delivered.

## Redaction

`status.nextStep` and every account reason go through the contract's `redactReason`: query values, bearer credentials,
JWTs and token-shaped words are replaced, and the line is cut to 160 characters. Status and logs never carry a URL
query string, a token or a credential.

## Confirmation

The only write is `export_markdown`, class `export`:

- under `access: "all"` it runs without an ask, and the tool's description says so;
- under `ask-changes` it asks first;
- under `read-only` it is refused.

A local export has no plan/commit pair: `overwrite` defaults to false, the path must stay inside `exportDirectory`, and
a target that is a link or a folder is refused. The pass-through Granola writes (`update_*`, `remove_*`,
`give_feedback`) are executed by Granola's MCP server; the plugin declares each one's class, and the access module
generates its rule. `give_feedback` sends a report to Granola's team, so the namespace line and the skill both say to
call it only when the user asks.

## Reporting

Report a vulnerability through GitHub's private vulnerability reporting on this repository. Do not open a public issue
with a credential, a token or a person's data in it.
