# Security

## Reporting a vulnerability

Report a vulnerability through GitHub's private vulnerability reporting on this repository. Do not open a public issue
with a credential, a token or a person's data in it.

## What this plugin holds

Nothing. Granola's MCP server holds the credentials and OpenCode owns the OAuth session. The plugin never reads,
prints or stores a token, and it has no HTTP client of its own: every Granola call goes through the MCP tool executor
OpenCode provides for the alias.

See [docs/security.md](docs/security.md) for what leaves the machine, the scopes, redaction and the export's local
write.
