import { Command } from 'commander';
import { client } from '../lib/api-client.js';
import { outputJson, htmlToPlainText, buildName } from '../lib/output.js';
import { withErrorHandling, requireConfirmation, parseIdArg } from '../lib/command-utils.js';
import { buildDateQuery } from '../lib/dates.js';
import { normalizeConversationStatus } from '../lib/conversation-status.js';
import type { Conversation, DraftConversationStatus, Thread } from '../types/index.js';

interface ParticipantInfo {
  name?: string;
  email?: string;
  messageCount: number;
  firstMessage?: string;
}

interface ConversationSummary {
  total: number;
  byStatus: Record<string, number>;
  byTag: Record<string, number>;
  conversations: Array<{
    id: number;
    subject: string;
    status: string;
    tags: string[];
    customer: ParticipantInfo;
    user: ParticipantInfo;
  }>;
}

const MAX_MESSAGE_LENGTH = 300;

function truncate(text: string): string {
  if (text.length <= MAX_MESSAGE_LENGTH) return text;
  return text.slice(0, MAX_MESSAGE_LENGTH).trim() + '...';
}

function buildPersonName(info: { first?: string; last?: string } | undefined): string | undefined {
  if (!info) return undefined;
  return buildName(info.first, info.last);
}

function extractThreadInfo(threads: Thread[] | undefined): {
  customer: ParticipantInfo;
  user: ParticipantInfo;
} {
  if (!threads?.length) {
    return {
      customer: { messageCount: 0 },
      user: { messageCount: 0 },
    };
  }

  const sortedThreads = [...threads].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const customerThreads = sortedThreads.filter((t) => t.type === 'customer');
  const userThreads = sortedThreads.filter((t) => t.type === 'message');

  const firstCustomerWithBody = customerThreads.find((t) => t.body);
  const firstUserWithBody = userThreads.find((t) => t.body);
  const mostRecentUserThread = userThreads[userThreads.length - 1];

  const customerSource = firstCustomerWithBody?.customer || firstCustomerWithBody?.createdBy;
  const userSource = mostRecentUserThread?.createdBy;

  return {
    customer: {
      name: buildPersonName(customerSource),
      email: customerSource?.email,
      messageCount: customerThreads.length,
      firstMessage: firstCustomerWithBody?.body
        ? truncate(htmlToPlainText(firstCustomerWithBody.body))
        : undefined,
    },
    user: {
      name: buildPersonName(userSource),
      email: userSource?.email,
      messageCount: userThreads.length,
      firstMessage: firstUserWithBody?.body
        ? truncate(htmlToPlainText(firstUserWithBody.body))
        : undefined,
    },
  };
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
    conversations: conversations.map((c) => {
      const threadInfo = extractThreadInfo(c._embedded?.threads);
      return {
        id: c.id,
        subject: c.subject,
        status: c.status,
        tags: (c.tags || []).map((t) => t.name),
        ...threadInfo,
      };
    }),
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
    .option('--created-since <date>', 'Show conversations created after this date')
    .option('--created-before <date>', 'Show conversations created before this date')
    .option('--modified-since <date>', 'Show conversations modified after this date')
    .option('--modified-before <date>', 'Show conversations modified before this date')
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
          createdSince?: string;
          createdBefore?: string;
          modifiedSince?: string;
          modifiedBefore?: string;
          sortField?: string;
          sortOrder?: string;
          page?: string;
          embed?: string;
          query?: string;
          summary?: boolean;
        }) => {
          const query = buildDateQuery(
            {
              createdSince: options.createdSince,
              createdBefore: options.createdBefore,
              modifiedSince: options.modifiedSince,
              modifiedBefore: options.modifiedBefore,
            },
            options.query
          );

          if (options.summary) {
            const allConversations = await client.listAllConversations({
              mailbox: options.mailbox,
              status: options.status,
              tag: options.tag,
              assignedTo: options.assignedTo,
              query,
              embed: 'threads',
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
            sortField: options.sortField,
            sortOrder: options.sortOrder,
            page: options.page ? parseInt(options.page, 10) : undefined,
            embed: options.embed,
            query,
          });
          outputJson(result);
        }
      )
    );

  cmd
    .command('view')
    .description('View a conversation')
    .argument('<id>', 'Conversation ID')
    .action(
      withErrorHandling(async (id: string) => {
        const conversation = await client.getConversation(parseIdArg(id, 'conversation'), 'threads');
        const threadInfo = extractThreadInfo(conversation._embedded?.threads);
        const result = {
          ...conversation,
          customer: threadInfo.customer,
          user: threadInfo.user,
        };
        outputJson(result, { plain: true });
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
    .option('--html', 'Output thread bodies as HTML (default is plain text)')
    .action(
      withErrorHandling(
        async (
          id: string,
          options: { includeNotes?: boolean; all?: boolean; type?: string; html?: boolean }
        ) => {
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

          outputJson(threads, { plain: !options.html });
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
    .command('status')
    .description('Update a conversation status')
    .argument('<id>', 'Conversation ID')
    .argument('<status>', 'New status (active, open, pending, closed, spam)')
    .action(
      withErrorHandling(async (id: string, status: string) => {
        const normalizedStatus = normalizeConversationStatus(status);
        await client.updateConversationStatus(parseIdArg(id, 'conversation'), normalizedStatus);
        outputJson({ message: 'Conversation status updated', status: normalizedStatus });
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
    .command('draft-reply')
    .description('Create a draft reply on an existing conversation (never sends — review and send from the Help Scout UI)')
    .argument('<id>', 'Conversation ID')
    .requiredOption('--text <text>', 'Reply text')
    .option('--user <id>', 'User ID authoring the draft')
    .action(
      withErrorHandling(
        async (
          id: string,
          options: {
            text: string;
            user?: string;
          }
        ) => {
          await client.createDraftReply(parseIdArg(id, 'conversation'), {
            text: options.text,
            user: options.user ? parseIdArg(options.user, 'user') : undefined,
          });
          outputJson({ message: 'Draft reply created' });
        }
      )
    );

  cmd
    .command('draft-conversation')
    .description('Create a new outbound draft conversation (never sends — review and send from the Help Scout UI)')
    .requiredOption('--mailbox <id>', 'Mailbox ID to create the conversation in')
    .requiredOption('--customer-email <email>', 'Recipient customer email address')
    .requiredOption('--subject <subject>', 'Conversation subject')
    .requiredOption('--text <text>', 'Draft message body')
    .option('--user <id>', 'User ID authoring the draft')
    .option('--type <type>', 'Conversation type: email, chat, or phone (default email)')
    .option('--status <status>', 'Conversation status: active, pending, or closed (default active)')
    .option('--tag <tag...>', 'Tag to apply (repeatable)')
    .action(
      withErrorHandling(
        async (options: {
          mailbox: string;
          customerEmail: string;
          subject: string;
          text: string;
          user?: string;
          type?: 'email' | 'chat' | 'phone';
          status?: DraftConversationStatus;
          tag?: string[];
        }) => {
          const result = await client.createDraftConversation({
            mailboxId: parseIdArg(options.mailbox, 'mailbox'),
            customerEmail: options.customerEmail,
            subject: options.subject,
            text: options.text,
            user: options.user ? parseIdArg(options.user, 'user') : undefined,
            type: options.type,
            status: options.status,
            tags: options.tag,
          });
          outputJson({ message: 'Draft conversation created', conversationId: result.id });
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
