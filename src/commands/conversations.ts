import { Command } from 'commander';
import { client } from '../lib/api-client.js';
import { outputJson } from '../lib/output.js';
import { withErrorHandling, requireConfirmation, parseIdArg } from '../lib/command-utils.js';
import { parseDateTime } from '../lib/dates.js';
import type { Conversation } from '../types/index.js';

interface ConversationSummary {
  total: number;
  byStatus: Record<string, number>;
  byTag: Record<string, number>;
  conversations: Array<{
    id: number;
    subject: string;
    status: string;
    tags: string[];
    preview: string;
  }>;
}

function summarizeConversations(conversations: Conversation[]): ConversationSummary {
  const byStatus: Record<string, number> = {};
  const byTag: Record<string, number> = {};

  for (const conv of conversations) {
    byStatus[conv.status] = (byStatus[conv.status] || 0) + 1;

    for (const tag of conv.tags || []) {
      byTag[tag.name] = (byTag[tag.name] || 0) + 1;
    }
  }

  return {
    total: conversations.length,
    byStatus,
    byTag,
    conversations: conversations.map((c) => ({
      id: c.id,
      subject: c.subject,
      status: c.status,
      tags: (c.tags || []).map((t) => t.name),
      preview: c.preview,
    })),
  };
}

export function createConversationsCommand(): Command {
  const cmd = new Command('conversations').description('Conversation operations');

  cmd
    .command('list')
    .description('List conversations')
    .option('-m, --mailbox <id>', 'Filter by mailbox ID')
    .option('-s, --status <status>', 'Filter by status (active, all, closed, open, pending, spam)')
    .option('-t, --tag <tags>', 'Filter by tag(s), comma-separated')
    .option('--assigned-to <id>', 'Filter by assignee user ID')
    .option('--modified-since <date>', 'Filter by modified date')
    .option(
      '--sort-field <field>',
      'Sort by field (createdAt, modifiedAt, number, status, subject)'
    )
    .option('--sort-order <order>', 'Sort order (asc, desc)')
    .option('--page <number>', 'Page number')
    .option('--embed <resources>', 'Embed resources (threads)')
    .option(
      '-q, --query <query>',
      'Advanced search query (see https://docs.helpscout.com/article/47-search-filters-with-operators)'
    )
    .option('--summary', 'Output aggregated summary instead of full conversation list')
    .action(
      withErrorHandling(
        async (options: {
          mailbox?: string;
          status?: string;
          tag?: string;
          assignedTo?: string;
          modifiedSince?: string;
          sortField?: string;
          sortOrder?: string;
          page?: string;
          embed?: string;
          query?: string;
          summary?: boolean;
        }) => {
          const modifiedSince = options.modifiedSince
            ? parseDateTime(options.modifiedSince)
            : undefined;

          if (options.summary) {
            const allConversations = await client.listAllConversations({
              mailbox: options.mailbox,
              status: options.status,
              tag: options.tag,
              assignedTo: options.assignedTo,
              modifiedSince,
              query: options.query,
            });
            const summary = summarizeConversations(allConversations);
            outputJson(summary);
            return;
          }

          const result = await client.listConversations({
            mailbox: options.mailbox,
            status: options.status,
            tag: options.tag,
            assignedTo: options.assignedTo,
            modifiedSince,
            sortField: options.sortField,
            sortOrder: options.sortOrder,
            page: options.page ? parseInt(options.page, 10) : undefined,
            embed: options.embed,
            query: options.query,
          });
          outputJson(result);
        }
      )
    );

  cmd
    .command('view')
    .description('View a conversation')
    .argument('<id>', 'Conversation ID')
    .option('--embed <resources>', 'Embed resources (threads)')
    .action(
      withErrorHandling(async (id: string, options: { embed?: string }) => {
        const conversation = await client.getConversation(
          parseIdArg(id, 'conversation'),
          options.embed
        );
        outputJson(conversation);
      })
    );

  cmd
    .command('threads')
    .description('List threads for a conversation (defaults to email communications only)')
    .argument('<id>', 'Conversation ID')
    .option('--include-notes', 'Include internal notes')
    .option('--all', 'Show all thread types including lineitems, workflows, etc.')
    .option(
      '-t, --type <types>',
      'Filter by specific thread type(s), comma-separated (customer, message, note, lineitem, chat, phone, forwardchild, forwardparent, beaconchat)'
    )
    .action(
      withErrorHandling(
        async (id: string, options: { includeNotes?: boolean; all?: boolean; type?: string }) => {
          let threads = await client.getConversationThreads(parseIdArg(id, 'conversation'));

          if (options.type) {
            const types = options.type.split(',').map((t) => t.trim().toLowerCase());
            threads = threads.filter((t) => types.includes(t.type));
          } else if (!options.all) {
            const allowedTypes = options.includeNotes
              ? ['customer', 'message', 'note', 'chat', 'phone']
              : ['customer', 'message', 'chat', 'phone'];
            threads = threads.filter((t) => allowedTypes.includes(t.type));
          }

          outputJson(threads);
        }
      )
    );

  cmd
    .command('delete')
    .description('Delete a conversation')
    .argument('<id>', 'Conversation ID')
    .option('-y, --yes', 'Skip confirmation')
    .action(
      withErrorHandling(async (id: string, options: { yes?: boolean }) => {
        requireConfirmation('conversation', options.yes);
        await client.deleteConversation(parseIdArg(id, 'conversation'));
        outputJson({ message: 'Conversation deleted' });
      })
    );

  cmd
    .command('add-tag')
    .description('Add a tag to a conversation')
    .argument('<id>', 'Conversation ID')
    .argument('<tag>', 'Tag name')
    .action(
      withErrorHandling(async (id: string, tag: string) => {
        await client.addConversationTag(parseIdArg(id, 'conversation'), tag);
        outputJson({ message: `Tag "${tag}" added` });
      })
    );

  cmd
    .command('remove-tag')
    .description('Remove a tag from a conversation')
    .argument('<id>', 'Conversation ID')
    .argument('<tag>', 'Tag name')
    .action(
      withErrorHandling(async (id: string, tag: string) => {
        await client.removeConversationTag(parseIdArg(id, 'conversation'), tag);
        outputJson({ message: `Tag "${tag}" removed` });
      })
    );

  cmd
    .command('reply')
    .description('Reply to a conversation')
    .argument('<id>', 'Conversation ID')
    .requiredOption('--text <text>', 'Reply text')
    .option('--user <id>', 'User ID sending the reply')
    .option('--draft', 'Save as draft')
    .option('--status <status>', 'Set conversation status after reply (active, closed, pending)')
    .action(
      withErrorHandling(
        async (
          id: string,
          options: {
            text: string;
            user?: string;
            draft?: boolean;
            status?: string;
          }
        ) => {
          await client.createReply(parseIdArg(id, 'conversation'), {
            text: options.text,
            user: options.user ? parseIdArg(options.user, 'user') : undefined,
            draft: options.draft,
            status: options.status,
          });
          outputJson({ message: 'Reply sent' });
        }
      )
    );

  cmd
    .command('note')
    .description('Add a note to a conversation')
    .argument('<id>', 'Conversation ID')
    .requiredOption('--text <text>', 'Note text')
    .option('--user <id>', 'User ID adding the note')
    .action(
      withErrorHandling(
        async (
          id: string,
          options: {
            text: string;
            user?: string;
          }
        ) => {
          await client.createNote(parseIdArg(id, 'conversation'), {
            text: options.text,
            user: options.user ? parseIdArg(options.user, 'user') : undefined,
          });
          outputJson({ message: 'Note added' });
        }
      )
    );

  return cmd;
}
