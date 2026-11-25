# Accounts

Several aliases at once, each signed in separately.

<!-- generated:accounts -->
Accounts are held by the **mcp** mechanism: the vendor's MCP server holds them.

The profile has no fields.
<!-- /generated:accounts -->

## Sign in

The mechanism is `mcp`: Granola's official MCP server holds the credentials. OpenCode adds one remote server per
alias, named `granola` for `default` and `granola-<alias>` for every other alias. Each server has its own OAuth
session, so two aliases are two independent sign-ins.

Sign in through OpenCode's MCP sign-in, once per alias. In a terminal, `opencode mcp auth granola-work` opens the
sign-in page for the `work` alias. To sign out, use `opencode mcp logout granola-work`; the plugin declares no
`sign_out` method, so an agent cannot end a session for the person.

The profile has no fields: the MCP server holds the sign-in, and the plugin has nothing else to configure per alias.

## Picking an account

Pass `account: "<alias>"` on every method that takes one: `events_list`, `probe` and `export_markdown`. With two
aliases and no account, the call is refused with `ACCOUNT_REQUIRED`, whose next step lists the aliases. An alias the
plugin does not serve is `ACCOUNT_UNKNOWN`.

Granola's own MCP tools take no `account`: each alias is a different server, so `tools.granola-work.search_meetings`
reads the `work` account and no other. A permission rule for one alias never reaches another alias's tools.

Cursors are bound to the account. A cursor issued for `work` and passed with `personal` is `CURSOR_INVALID`, never a
silent restart.

## Status

`status` lists every alias in the order the options name them, with `ready`, `needs_sign_in` or `error`. The owner is
present once `probe` or `events_list` has read it for that alias. A failure's reason is one line of
at most 160 characters, with query values, bearer credentials and token-shaped words replaced.
