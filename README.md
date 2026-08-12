# Help Scout CLI

[![npm version](https://img.shields.io/npm/v/@stephendolan/helpscout-cli.svg)](https://www.npmjs.com/package/@stephendolan/helpscout-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A CLI for Help Scout's Mailbox API 2.0. JSON output by default for LLM and automation workflows.

## Installation

```bash
bun install -g @stephendolan/helpscout-cli

# Or run without installing
bunx @stephendolan/helpscout-cli conversations list
```

**Linux**: Requires `libsecret` for keychain storage (`apt install libsecret-1-dev`), or use environment variables.

## Authentication

Create an OAuth app at [Help Scout > Your Profile > My Apps](https://secure.helpscout.net/authentication/authorizeClientApplication).

```bash
helpscout auth login --app-id YOUR_APP_ID --app-secret YOUR_APP_SECRET
helpscout auth status
helpscout auth logout
helpscout auth refresh                          # Refresh access token
```

Or use environment variables: `HELPSCOUT_APP_ID`, `HELPSCOUT_APP_SECRET`, `HELPSCOUT_MAILBOX_ID`

## Commands

### Conversations

```bash
helpscout conversations list
helpscout conversations list --status active --mailbox 123 --tag urgent
helpscout conversations list -q 'status:open customer:john@example.com'
helpscout conversations list --summary

helpscout conversations view 456
helpscout conversations threads 456
helpscout conversations threads 456 --type customer  # Filter by type
helpscout conversations threads 456 --html          # HTML output
helpscout conversations threads 456 --include-notes
helpscout conversations draft-replies list 456
helpscout conversations draft-replies create 456 --text "Unsent draft"
helpscout conversations draft-replies update 456 987654 --text "Revised unsent draft"
helpscout conversations draft-replies upsert 456 --text "Desired unsent draft"
helpscout conversations draft-replies upsert 456 --thread-id 987654 --text "Chosen draft"
helpscout conversations draft-reply 456 --text "Desired unsent draft" # shorthand for upsert
helpscout conversations attachments download 456 789
helpscout conversations attachments download 456 789 --output ./invoice.pdf
helpscout conversations attachments download 456 789 --output ./downloads/
helpscout conversations attachments download 456 789 --force
helpscout conversations status 456 closed
helpscout conversations note 456 --text "Internal note"
helpscout conversations add-tag 456 urgent
helpscout conversations remove-tag 456 urgent
helpscout conversations delete 456
```

### Customers

```bash
helpscout customers list
helpscout customers list --first-name John
helpscout customers view 789
helpscout customers create --first-name John --last-name Doe --email john@example.com
helpscout customers update 789 --organization "Acme Corp"
helpscout customers delete 789
```

### Users

```bash
helpscout users list
helpscout users list --email user@example.com
helpscout users list --mailbox 123 --page 2
helpscout users view 456
```

User responses include the `mention` handle when Help Scout returns one. Use `@mention` in Help Scout thread bodies to mention teammates.

### Tags, Workflows, Mailboxes

```bash
helpscout tags list
helpscout tags view 123

helpscout workflows list
helpscout workflows list --type manual
helpscout workflows run 123 --conversations 456,789
helpscout workflows activate 123
helpscout workflows deactivate 123

helpscout mailboxes list
helpscout mailboxes view 123
helpscout mailboxes set-default 123
helpscout mailboxes get-default
helpscout mailboxes clear-default
```

### MCP Server

Run as an MCP server for AI agent integration:

```bash
helpscout mcp
```

The MCP server exposes:

- Typed tools for Help Scout search, full conversation detail, full conversation thread history, attachment downloads, mailbox/customer/user lookup, and safe draft-note/status mutations
- `get_conversation` accepts internal conversation IDs or visible ticket numbers like `#12345`
- `get_conversation_threads` returns all Help Scout thread types by default, including notes, workflow events, status events, and other system events returned by Help Scout
- `list_draft_replies` returns active unsent reply drafts with thread IDs, bodies/previews, recipients, authors, and timestamps
- `create_draft_reply` intentionally creates an additional unsent draft and returns its verified Help Scout `Resource-ID` thread ID
- `update_draft_reply` replaces `/text` only after verifying the selected thread is still an unsent reply draft, then verifies the live result
- `upsert_draft_reply` updates the sole active draft or creates one when none exists; it refuses multiple drafts unless `threadId` explicitly selects one
- `download_attachment` saves a conversation attachment to disk, using the Help Scout filename by default and requiring `force` before overwriting existing files
- `update_conversation_status` safely changes ticket status, with `open` normalized to Help Scout's `active` status
- `create_note` adds private notes and can optionally set the ticket status, such as closing no-action tickets
- User lookup tools expose Help Scout mention handles for composing `@mention` references
- Resource templates for `helpscout://conversation/{conversationId}`, `helpscout://customer/{customerId}`, and `helpscout://user/{userId}`
- Prompt templates for `summarize_ticket` and `draft_reply`

Read-only tools include MCP annotations so hosts can distinguish them from mutating tools, and core read/query tools return structured outputs alongside readable JSON text.

### Draft reply safety

All draft-reply commands and MCP tools preserve the never-send boundary: they only list drafts, create with `draft: true`, or replace a draft thread's `/text`. Every create/update re-reads Help Scout and returns success only when the intended thread is still a draft with the requested text.

`draft-replies upsert` and the legacy `draft-reply` shorthand are the recommended write paths. With zero active drafts they create one; with one they update it in place; with multiple they refuse and print the candidate thread IDs. Pass `--thread-id` (or MCP `threadId`) only after selecting the intended draft from `draft-replies list` / `list_draft_replies`.

Help Scout's official Inbox API does not expose an endpoint to delete or discard a draft reply thread. Discard unwanted drafts in the Help Scout web UI.

## Options

| Flag | Description |
|------|-------------|
| `-c, --compact` | Minified JSON output |
| `-p, --plain` | Strip HTML from body fields |
| `-f, --fields <fields>` | Include only specified fields |
| `--include-metadata` | Include `_links` and `_embedded` |

## Examples

```bash
helpscout conversations list | jq '.conversations[].subject'
helpscout conversations list --fields id,subject
```

Errors: `{"error": {"name": "...", "detail": "...", "statusCode": 400}}`

## References

- [Help Scout API Docs](https://developer.helpscout.com/mailbox-api/)
- [Search Filters](https://docs.helpscout.com/article/47-search-filters-with-operators)

## License

MIT
