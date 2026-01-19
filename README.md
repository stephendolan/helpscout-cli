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
helpscout conversations reply 456 --text "Thanks for reaching out!"
helpscout conversations reply 456 --text "Issue resolved" --status closed
helpscout conversations note 456 --text "Internal note"
helpscout conversations note 456 --text "Escalating to engineering" --status pending
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
