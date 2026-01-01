#!/usr/bin/env bun

import { Command } from 'commander';
import { setOutputOptions } from './lib/output.js';
import { createAuthCommand } from './commands/auth.js';
import { createMailboxesCommand } from './commands/mailboxes.js';
import { createConversationsCommand } from './commands/conversations.js';
import { createCustomersCommand } from './commands/customers.js';
import { createTagsCommand } from './commands/tags.js';
import { createWorkflowsCommand } from './commands/workflows.js';
import { createMcpCommand } from './commands/mcp.js';

declare const __VERSION__: string;

const program = new Command();

program
  .name('helpscout')
  .description('A command-line interface for Help Scout')
  .version(__VERSION__)
  .option('-c, --compact', 'Minified JSON output (single line)')
  .option('-p, --plain', 'Strip HTML from body fields, output plain text')
  .option('--include-metadata', 'Include _links and _embedded in responses (stripped by default)')
  .option('-f, --fields <fields>', 'Comma-separated list of fields to include in output')
  .hook('preAction', (thisCommand) => {
    const options = thisCommand.opts();
    setOutputOptions({
      compact: options.compact,
      slim: !options.includeMetadata,
      plain: options.plain,
      fields: options.fields,
    });
  });

program.addCommand(createAuthCommand());
program.addCommand(createMailboxesCommand());
program.addCommand(createConversationsCommand());
program.addCommand(createCustomersCommand());
program.addCommand(createTagsCommand());
program.addCommand(createWorkflowsCommand());
program.addCommand(createMcpCommand());

program.parseAsync().catch(() => {
  process.exit(1);
});
