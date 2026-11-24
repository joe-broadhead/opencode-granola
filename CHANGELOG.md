# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 0.0.0 (unreleased)

### Added

- Granola's official MCP server (`https://mcp.granola.ai/mcp`) as the `granola` namespace, with the prompt rules its
  server text omits: label Granola's AI answers as Granola's, call `give_feedback` only when the user asks, and use
  Memory first for who the user is.
- The default permission block for every agent with a base allow, the `access` option (`all`, `ask-changes`,
  `read-only`), `/granola-status` and the TUI status dialog.
- `export_markdown`: 1 to 20 meetings' notes and transcripts into the export folder, without passing the text through
  the conversation.
- The `granola.meetings` source and its `granola.meetings.list` snapshot, with `events_list` and `probe`.
- Two skills, `granola` and `granola-meeting-brief`.
- OpenCode `>=2.4.1 <2.5.0` support, tested on 2.4.1.

The package is `@we-the-rebel-alliance/granola-plugin`, and this is its first release.
