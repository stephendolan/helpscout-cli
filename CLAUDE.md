# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Help Scout CLI is a command-line interface for Help Scout's Inbox API 2.0, designed for LLMs and developers to interface with Help Scout data. The CLI outputs JSON by default for easy parsing and automation.

## Development Commands

### Running and Building
```bash
bun run dev          # Run CLI in development mode (no build required)
bun run build        # Build for production using tsup
bun run link         # Build and link globally (makes `helpscout` available system-wide)
bun run start        # Run built CLI from dist/

# Testing the CLI locally
bun run src/cli.ts <command>     # Run directly without building
bun dist/cli.js <command>        # Run after building
```

### Quality Checks
```bash
bun run typecheck    # Type check without emitting files
bun run lint         # Lint TypeScript files in src/
bun test             # Run vitest tests
```

## Architecture

### Core Structure

The CLI follows a command-based architecture built on Commander.js:

- **src/cli.ts**: Entry point that registers all commands and handles global flags (`--compact`)
- **src/commands/**: Each file exports a `create*Command()` function that returns a Commander Command
  - Commands: auth, mailboxes, conversations, customers, tags, workflows
- **src/lib/**: Shared utilities and core functionality
  - **api-client.ts**: Main Help Scout API wrapper (`HelpScoutClient` class) - single source of truth for API calls
  - **auth.ts**: OS keychain integration via @napi-rs/keyring for secure credential storage
  - **config.ts**: Application config management via `conf` package (stores default mailbox ID)
  - **output.ts**: JSON output formatting
  - **errors.ts**: Centralized error handling for Help Scout API errors
  - **command-utils.ts**: Shared command helpers
- **src/types/**: TypeScript type definitions

### Authentication Flow

Help Scout uses OAuth 2.0 with Client Credentials flow:

1. User provides app_id and app_secret via `helpscout auth login`
2. Credentials stored in OS keychain via @napi-rs/keyring
3. Access token obtained via POST to `/v2/oauth2/token`
4. Tokens auto-refresh on 401 responses
5. Environment variables supported: `HELPSCOUT_APP_ID`, `HELPSCOUT_APP_SECRET`, `HELPSCOUT_MAILBOX_ID`

### Output System

All commands use `outputJson()` from src/lib/output.ts which:
1. Formats as JSON (pretty or compact based on `--compact` flag)
2. Writes to stdout

List commands return objects with data arrays and pagination info for consistency with the Help Scout API.

### Error Handling

All API calls go through `HelpScoutClient.withErrorHandling()` which catches errors and passes them to `handleHelpScoutError()` in src/lib/errors.ts. Errors are output as JSON:
```json
{
  "error": {
    "name": "error_name",
    "detail": "Error detail",
    "statusCode": 400
  }
}
```

## Adding New Commands

1. Create or modify file in src/commands/
2. Export a `create*Command()` function that returns a Commander Command
3. Register in src/cli.ts
4. Use `client` from src/lib/api-client.ts for API calls
5. Use `outputJson()` for JSON output

## API Reference

Base URL: `https://api.helpscout.net/v2`

### Rate Limits
- 200 requests/minute per account
- 12 write requests per 5 seconds (POST, PUT, DELETE)
- Returns 429 when exceeded

### Key Endpoints Used
- `/conversations` - List, view, delete conversations; manage threads, tags
- `/customers` - CRUD operations on customers
- `/tags` - List and view tags
- `/workflows` - List, run manual workflows, activate/deactivate
- `/mailboxes` - List and view mailboxes
- `/oauth2/token` - Authentication

## Build Configuration

- **tsup.config.ts**: Bundles src/cli.ts → dist/cli.js as ESM
- **package.json**: Type is "module" (ESM), main is dist/cli.js, bin is "helpscout"
- Shebang `#!/usr/bin/env bun` in src/cli.ts makes dist/cli.js directly executable
