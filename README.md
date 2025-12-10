# Help Scout CLI

A command-line interface for Help Scout, designed for LLMs and developers.

## Installation

```bash
npm install -g @stephendolan/helpscout-cli
```

## Authentication

Help Scout uses OAuth 2.0. Create an OAuth application at [Help Scout > Your Profile > My Apps](https://secure.helpscout.net/authentication/authorizeClientApplication).

```bash
helpscout auth login --app-id YOUR_APP_ID --app-secret YOUR_APP_SECRET
```

Or use environment variables:
```bash
export HELPSCOUT_APP_ID=your_app_id
export HELPSCOUT_APP_SECRET=your_app_secret
```

## Usage

### Conversations

```bash
# List conversations
helpscout conversations list
helpscout conversations list --status active
helpscout conversations list --mailbox 123 --tag urgent

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

## Output

All commands output JSON for easy parsing:

```bash
# Get all conversation subjects
helpscout conversations list | jq '.conversations[].subject'

# Get only id and subject fields
helpscout conversations list --fields id,subject

# Get plain text bodies (HTML stripped)
helpscout conversations threads 456 --plain
```

### Conversation Summary

Use `--summary` to get an aggregated view instead of raw conversation data:

```bash
helpscout conversations list --summary
```

### Advanced Search

Use `-q, --query` for Help Scout's advanced search syntax:

```bash
helpscout conversations list -q 'status:open tag:urgent'
helpscout conversations list -q 'customer:john@example.com'
```

See [Help Scout Search Filters](https://docs.helpscout.com/article/47-search-filters-with-operators) for full query syntax.

## License

MIT
