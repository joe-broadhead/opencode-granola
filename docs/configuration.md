# Configuration

The options and their defaults, generated from `capabilities.options`.

<!-- generated:configuration -->
| Option | Type | Default | Description |
|---|---|---|---|
| `access` | `all` \| `ask-changes` \| `read-only` | `"all"` | How much the plugin's methods may do. |
| `accounts` | object | — | One profile per account alias. The MCP server holds each alias's sign-in, so a profile has no fields of its own. |
| `exportDirectory` | string | `"~/Granola"` | Folder for Markdown exports. Absolute, or starting with ~/. |
| `allowUntestedHost` | boolean | `false` | Start outside the tested OpenCode range. |
<!-- /generated:configuration -->

## Configure two accounts

```json
{
  "access": "ask-changes",
  "accounts": { "work": {}, "personal": {} },
  "exportDirectory": "/home/ana/Granola",
  "allowUntestedHost": false
}
```

- `access` is the ceiling. `all` runs every method, `ask-changes` asks before a non-read and `read-only` refuses one.
- `accounts` is one profile per alias, in the order status lists them. A profile has no fields: the MCP server holds
  the sign-in.
- `exportDirectory` is where `export_markdown` writes. It may be absolute or start with `~/`; the default is
  `~/Granola`.
- `allowUntestedHost` starts the plugin outside `>=2.4.1 <2.5.0`. Leave it `false`: the plugin refuses an untested
  host with `HOST_UNTESTED` and a next step.

## One account

With no `accounts` option there is exactly one `default` account, served by the MCP server `granola`:

```json
{ "access": "read-only" }
```

Methods that take an `account` may leave it out when the plugin has one account.
