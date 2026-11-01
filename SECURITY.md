# Security

## Supported versions

Fixes go into the newest release. Older releases are not patched.

## Reporting a vulnerability

Report vulnerabilities privately through GitHub's private vulnerability reporting: open the repository's **Security**
tab and choose **Report a vulnerability**. Do not open a public issue. Include the plugin version, the OpenCode
version, your plugin options and the steps to reproduce. Never include tokens, sign-in links or meeting content.

Vulnerabilities in Granola's service or in OpenCode itself are out of scope. Report those to Granola or to the
OpenCode project.

## Data handling

The plugin registers Granola's official MCP server, `https://mcp.granola.ai/mcp`, with OpenCode. OpenCode connects,
runs the sign-in, stores the credentials and asks for permission. The plugin never reads tokens and stores nothing:
the active workspace's display name is kept in memory only. It makes no network requests of its own.

- `/granola-status` reads only OpenCode's local state. It shows counts, the names of new Granola tools (only short,
  plain names, at most 20), the workspace display name, the export folder and the versions. It never shows email
  addresses or account IDs.
- The plugin never logs or stores meeting content. Errors never repeat OpenCode's sign-in error, which can contain a
  sign-in link. Other failure reasons are cut to one line, with web addresses replaced by `<url>`.
- `export_markdown` reads meetings through OpenCode's own Granola read tools, which check their own permissions, and
  writes only into the configured export folder. The folder and the folders an export creates get mode `0700`, and
  files get mode `0600`. Paths that leave the folder, name hidden files or go through a link are refused. Files are
  written atomically, and an existing file is replaced only with `overwrite: true`. The writer detects changes to the
  folders during a write, but it is not a sandbox against another program that rewrites them at the same time.
- Meeting content is untrusted. Notes, transcripts, AI summaries, titles and attachments hold what other people said
  and wrote, and can contain instructions aimed at the model. Known reads run without a prompt, so such text can reach
  the model without your review. The skills tell the model to treat meeting content as data, and exported files start
  with the same warning.
- OpenCode adds the instructions Granola's server sends to the system prompt while any Granola tool is available.
- Tool results go to your model provider, like any other tool result in the session.

## Permissions

What the model can do in Granola is limited by three layers, in this order:

1. **Your Granola account and plan.** Granola decides which tools your account gets and what they can reach.
2. **Default permission rules.** Granola's known reads run without a prompt. Everything else under `granola_` asks
   first: Granola's writes and sends, tools this plugin version does not know yet, and `export_markdown`. Granola's
   `sign_out` tool is hidden.
3. **Your OpenCode permissions.** Your `permissions` rules and saved "Always allow" answers override the defaults. A
   `deny` you configure always wins.

The [configuration guide](https://github.com/joe-broadhead/opencode-granola/blob/HEAD/docs/configuration.md#permissions)
has the rules and how to change them. Things to know:

- **Saved approvals are broad.** "Always allow" on a Granola tool saves the pattern `*` for that tool's action, and for
  an export it covers every path. The saved answer applies to every agent in the OpenCode project, Plan included, until
  you remove it. OpenCode identifies a project by its git repository. A folder with no git commit belongs to OpenCode's
  shared `global` project, so an approval saved there applies in every other such folder too.
- **Some agents get no default rules.** Agents defined only in your own config are created after the plugin inserts
  its rules, so Granola's writes run there without asking. `/granola-status` and the status dialog list them under
  Agents without default rules with the fix: put the Granola block first in that agent's own `permissions`, followed
  by your top-level rules for `granola_` actions. Do not put the block in the top-level `permissions`, which would
  loosen Explore.
- **Code Mode programs can catch a decline.** A declined call does not run, but the program can continue. Use `deny`
  rules for hard stops.
- **Unattended runs refuse prompts.** In `opencode run` and other runs where nobody can answer, a Granola call that
  would ask is refused. `opencode run --auto` approves every request that no rule denies.
- **The `granola_*` rule also matches other servers** whose names start with `granola_`. For their tools it only adds
  prompts.
