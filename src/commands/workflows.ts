import { Command } from 'commander';
import { client } from '../lib/api-client.js';
import { outputJson } from '../lib/output.js';
import { withErrorHandling, parseIdArg } from '../lib/command-utils.js';

export function createWorkflowsCommand(): Command {
  const cmd = new Command('workflows').description('Workflow operations');

  cmd
    .command('list')
    .description('List workflows')
    .option('-m, --mailbox <id>', 'Filter by mailbox ID')
    .option('-t, --type <type>', 'Filter by type (manual, automatic)')
    .option('--page <number>', 'Page number')
    .action(
      withErrorHandling(
        async (options: {
          mailbox?: string;
          type?: string;
          page?: string;
        }) => {
          const result = await client.listWorkflows({
            mailbox: options.mailbox ? parseIdArg(options.mailbox, 'mailbox') : undefined,
            type: options.type,
            page: options.page ? parseInt(options.page, 10) : undefined,
          });
          outputJson(result);
        }
      )
    );

  cmd
    .command('run')
    .description('Run a manual workflow on conversations')
    .argument('<workflow-id>', 'Workflow ID')
    .requiredOption('--conversations <ids>', 'Comma-separated conversation IDs')
    .action(
      withErrorHandling(async (workflowId: string, options: { conversations: string }) => {
        const conversationIds = options.conversations
          .split(',')
          .map((id) => parseIdArg(id.trim(), 'conversation'));
        await client.runWorkflow(parseIdArg(workflowId, 'workflow'), conversationIds);
        outputJson({ message: 'Workflow executed' });
      })
    );

  cmd
    .command('activate')
    .description('Activate a workflow')
    .argument('<id>', 'Workflow ID')
    .action(
      withErrorHandling(async (id: string) => {
        await client.updateWorkflowStatus(parseIdArg(id, 'workflow'), 'active');
        outputJson({ message: 'Workflow activated' });
      })
    );

  cmd
    .command('deactivate')
    .description('Deactivate a workflow')
    .argument('<id>', 'Workflow ID')
    .action(
      withErrorHandling(async (id: string) => {
        await client.updateWorkflowStatus(parseIdArg(id, 'workflow'), 'inactive');
        outputJson({ message: 'Workflow deactivated' });
      })
    );

  return cmd;
}
