# Help Scout CLI

[![npm version](https://img.shields.io/npm/v/@stephendolan/helpscout-cli.svg)](https://www.npmjs.com/package/@stephendolan/helpscout-cli)
[![npm downloads](https://img.shields.io/npm/dm/@stephendolan/helpscout-cli.svg)](https://www.npmjs.com/package/@stephendolan/helpscout-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/Bun-%3E%3D1.0-black)](https://bun.sh)

A command-line interface for Help Scout's Mailbox API 2.0, designed for LLMs and developers to quickly interface with Help Scout data.

## Features

- **LLM-First Design**: JSON output by default for easy parsing and integration with AI assistants
- **Output Control**: Strip HTML from bodies, select specific fields, exclude API metadata
- **Advanced Search**: Full query syntax support for filtering conversations
- **Comprehensive Coverage**: Conversations, customers, tags, workflows, and mailboxes
- **Type Safety**: Built with TypeScript for robust error handling
- **Simple Authentication**: OAuth 2.0 credentials stored securely in OS keychain

## Installation

Requires [Bun](https://bun.sh) runtime.

```bash
# Install globally with bun (recommended)
bun install -g @stephendolan/helpscout-cli

# Or run directly without installing
bunx @stephendolan/helpscout-cli conversations list
npx @stephendolan/helpscout-cli conversations list  # also works
```

### Linux Prerequisites

Requires `libsecret` for keychain storage:

```bash
# Ubuntu/Debian
sudo apt-get install libsecret-1-dev

# Fedora/RHEL
sudo dnf install libsecret-devel

# Arch Linux
sudo pacman -S libsecret
```

Without `libsecret`, use the environment variables instead.

### From Source

```bash
git clone https://github.com/stephendolan/helpscout-cli.git
cd helpscout-cli
bun install
bun run link  # Build and link globally
```

## Authentication

Help Scout uses OAuth 2.0 with Client Credentials. Create an OAuth application at [Help Scout > Your Profile > My Apps](https://secure.helpscout.net/authentication/authorizeClientApplication).

```bash
helpscout auth login --app-id YOUR_APP_ID --app-secret YOUR_APP_SECRET
helpscout auth status   # Check authentication status
helpscout auth logout   # Remove stored credentials
```

Or use environment variables:

```bash
export HELPSCOUT_APP_ID=your_app_id
export HELPSCOUT_APP_SECRET=your_app_secret
export HELPSCOUT_MAILBOX_ID=your_default_mailbox_id  # Optional
```

## Usage

### Conversations

```bash
# List conversations
helpscout conversations list
helpscout conversations list --status active
helpscout conversations list --mailbox 123 --tag urgent

# Advanced search
helpscout conversations list -q 'status:open tag:urgent'
helpscout conversations list -q 'customer:john@example.com'

# Aggregated summary
helpscout conversations list --summary

# View a conversation
helpscout conversations view 456

# View conversation threads
helpscout conversations threads 456

# Add/remove tags
helpscout conversations add-tag 456 urgent
helpscout conversations remove-tag 456 urgent

# Reply to a conversation
helpscout conversations reply 456 --text "Thank you for reaching out!"

# Add a note
helpscout conversations note 456 --text "Internal note here"

# Delete a conversation
helpscout conversations delete 456
```

### Customers

```bash
# List customers
helpscout customers list
helpscout customers list --first-name John

# View a customer
helpscout customers view 789

# Create a customer
helpscout customers create --first-name John --last-name Doe --email john@example.com

# Update a customer
helpscout customers update 789 --organization "Acme Corp"

# Delete a customer
helpscout customers delete 789
```

### Tags

```bash
# List all tags
helpscout tags list

# View a tag
helpscout tags view 123
```

### Workflows

```bash
# List workflows
helpscout workflows list
helpscout workflows list --type manual

# Run a manual workflow
helpscout workflows run 123 --conversations 456,789

# Activate/deactivate
helpscout workflows activate 123
helpscout workflows deactivate 123
```

### Mailboxes

```bash
# List mailboxes
helpscout mailboxes list

# View a mailbox
helpscout mailboxes view 123

# Set default mailbox
helpscout mailboxes set-default 123
```

## Global Options

- `-c, --compact` - Output minified JSON (single line)
- `-p, --plain` - Strip HTML from body fields, output plain text
- `-f, --fields <fields>` - Comma-separated list of fields to include in output
- `--include-metadata` - Include `_links` and `_embedded` in responses (stripped by default)
- `--help` - Show help for any command

## Output Format

All commands return JSON by default:

- **Lists**: Objects with data arrays and pagination info
- **Single items**: Objects directly
- **Errors**: `{"error": {"name": "...", "detail": "...", "statusCode": 400}}`

### Working with JSON Output

```bash
# Get all conversation subjects
helpscout conversations list | jq '.conversations[].subject'

# Get only id and subject fields
helpscout conversations list --fields id,subject

# Get plain text bodies (HTML stripped)
helpscout conversations threads 456 --plain

# Count conversations by status
helpscout conversations list --summary | jq '.byStatus'
```

## API Rate Limits

Help Scout enforces these rate limits:

- **200 requests per minute** per account
- **12 write requests per 5 seconds** (POST, PUT, DELETE)

When exceeded, the API returns HTTP 429 errors. The CLI will report these as JSON errors.

## References

- [Help Scout API Documentation](https://developer.helpscout.com/mailbox-api/)
- [Help Scout Search Filters](https://docs.helpscout.com/article/47-search-filters-with-operators)

## License

MIT
