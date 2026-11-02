# In Jelly

[Jelly](https://heyjelly.ai) runs OpenCode agents. It reads the `jelly` section of this
package's `package.json` as JSON, without loading the plugin, when a person reviews the exact
version, and uses it as follows.

## Tools and permissions

18 tools are declared (10 read-only). Jelly's agents have no base "allow everything"
rule, so this plugin's own default rules, which it puts after that rule, never reach them. Jelly
writes each declared `ask` or `deny` as that tool's default instead (the person's own choice
replaces it), and denies a read-only helper every tool not marked `readOnly`. A declared `allow`
changes nothing in Jelly.

- Ask: `granola_create_folder`, `granola_update_folder`, `granola_add_note_to_folder`, `granola_remove_note_from_folder`, `granola_update_private_notes`, `granola_generate_summary`, `granola_give_feedback`, `granola_export_markdown`.
- Off: none.
- Everything else runs, as the plugin's own rules let it.

A tool the upstream server adds later is not declared, so in Jelly it is not asked about by
default. Keep `jelly.tools` in step with the known-tool list; `test/**/jelly.test.ts` checks
each declared effect against the plugin's own default rules.

## Skills

Declared: `granola`, `granola-meeting-brief`. Jelly refuses an install whose
skill ids collide with another plugin's or the agent's own.

## Views

None yet.

## Signing in

Granola's MCP server `granola` signs in with OpenCode's MCP OAuth. Jelly shows the card `mcp:granola`.

<!-- AUTH-PLACEHOLDER (Jelly rd152): settings and secrets for signing in from Jelly are being
designed by Jelly's auth lane. Until that lands this package declares no `contributes.settings`;
add the auth declarations here and in package.json when that design is agreed. -->
**Not yet declared for Jelly.** How this plugin's sign-in appears in Jelly (desktop and web,
expiry, reconnect and sign-out) is still being designed; this section and
`jelly.contributes.settings` will say it once it is.

## Versions

Jelly's curated catalogue pins an exact version. `latest` is `0.0.0`; publish each release
under a new version so a review in Jelly can tell the two apart.
