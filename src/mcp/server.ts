import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { client } from '../lib/api-client.js';
import { auth } from '../lib/auth.js';
import { buildDateQuery } from '../lib/dates.js';
import { normalizeSearchQuery } from '../lib/search.js';
import type { Conversation, Thread } from '../types/index.js';

const DEFAULT_MAX_RESULTS = 25;
const DEFAULT_MAX_THREADS = 20;

/**
 * Strip HAL navigation links, photo URLs, placeholder values, and tag styles
 * from API responses. Keeps _embedded (carries actual data like threads) and
 * HTML bodies (LLMs parse structured HTML better than flattened plain text).
 */
function cleanForMcp(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(cleanForMcp);
  if (data === null || typeof data !== 'object') return data;

  const obj = data as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (key === '_links') continue;
    if (key === 'photoUrl') continue;
    if (key === 'color' && Object.keys(obj).includes('name') && Object.keys(obj).includes('slug')) continue; // tag style
    if (key === 'styles' && Object.keys(obj).includes('name') && Object.keys(obj).includes('slug')) continue; // tag style

    // Strip zero-valued IDs (HelpScout placeholder convention)
    if (key === 'id' && value === 0) continue;
    // Strip first/last when we'll synthesize a combined name below
    if ((key === 'first' || key === 'last') && ('first' in obj || 'last' in obj)) continue;

    result[key] = cleanForMcp(value);
  }

  // Synthesize combined name from first/last on person objects
  if ('first' in obj || 'last' in obj) {
    const first = typeof obj.first === 'string' ? obj.first : '';
    const last = typeof obj.last === 'string' ? obj.last : '';
    const name = `${first} ${last}`.trim();
    if (name) result.name = name;
  }

  return result;
}

/** Wrap search results with omission metadata when capped. */
function withOmissionMeta(all: Conversation[], maxResults: number) {
  const total = all.length;
  const conversations = total > maxResults ? all.slice(0, maxResults) : all;
  return {
    conversations: cleanForMcp(conversations),
    ...(total > maxResults && {
      total_results: total,
      returned: maxResults,
      omitted: total - maxResults,
    }),
  };
}

/** Cap threads, keeping first (original) + most recent. */
function capThreads(threads: Thread[], maxThreads: number) {
  if (threads.length <= maxThreads) {
    return { threads: cleanForMcp(threads) as unknown[] };
  }
  const kept = maxThreads <= 1
    ? [threads[0]]
    : [threads[0], ...threads.slice(-(maxThreads - 1))];
  return {
    threads: cleanForMcp(kept) as unknown[],
    total_threads: threads.length,
    returned_threads: kept.length,
    omitted_threads: threads.length - kept.length,
  };
}

const toolRegistry = [
  { name: 'list_conversations', description: 'List conversations with optional filtering by status, mailbox, tag, assignee, or date range' },
  { name: 'get_conversation', description: 'Get detailed information about a specific conversation including threads' },
  { name: 'search_conversations', description: 'Search all conversations matching a query (fetches all pages). WARNING: Compound filters (e.g., "email:user@domain.com billing") are unreliable — the API may ignore parts of the query. Use one filter per call and combine results.' },
  { name: 'search_by_customer', description: 'Find all conversations involving a customer by email — searches primary email and domain, deduplicates results' },
  { name: 'get_conversations_summary', description: 'Get aggregated summary of conversations by status and tag (for weekly briefings)' },
  { name: 'list_mailboxes', description: 'List all mailboxes in the Help Scout account' },
  { name: 'get_mailbox', description: 'Get detailed information about a specific mailbox' },
  { name: 'list_customers', description: 'List customers with optional filtering' },
  { name: 'get_customer', description: 'Get detailed information about a specific customer' },
  { name: 'list_tags', description: 'List all tags in the Help Scout account' },
  { name: 'list_workflows', description: 'List workflows with optional filtering' },
  { name: 'create_note', description: 'Add a private note to a conversation' },
  { name: 'create_draft', description: 'Create a draft reply on a conversation (saves without sending)' },
  { name: 'add_tag', description: 'Add a tag to a conversation' },
  { name: 'check_auth', description: 'Check if Help Scout authentication is configured' },
];

interface ConversationSummary {
  total: number;
  byStatus: Record<string, number>;
  byTag: Record<string, number>;
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

  return { total: conversations.length, byStatus, byTag };
}

const server = new McpServer({
  name: 'helpscout',
  version: '1.0.0',
});

function jsonResponse(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

const dateFilterSchema = {
  createdSince: z.string().optional().describe('Filter by creation date — returns only conversations created after this date. Does not include older conversations with recent activity; use modifiedSince for that.'),
  createdBefore: z.string().optional().describe('Filter by creation date — returns only conversations created before this date'),
  modifiedSince: z.string().optional().describe('Filter by last activity date — returns conversations with ANY activity (replies, notes, status changes, tag changes) after this date, including old conversations. Use createdSince to filter by creation date instead.'),
  modifiedBefore: z.string().optional().describe('Filter by last activity date — returns conversations with last activity before this date'),
};

const GENERIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'hey.com',
  'protonmail.com',
  'proton.me',
  'fastmail.com',
  'tutanota.com',
]);

server.tool(
  'list_conversations',
  'List conversations with optional filtering by status, mailbox, tag, assignee, or date range',
  {
    status: z
      .enum(['active', 'pending', 'closed', 'spam', 'all'])
      .optional()
      .describe('Conversation status filter (defaults to "all" to include resolved tickets)'),
    mailbox: z.string().optional().describe('Mailbox ID to filter by'),
    tag: z.string().optional().describe('Tag to filter by'),
    assignedTo: z.string().optional().describe('User ID assigned to'),
    query: z.string().optional().describe('Search query. Multi-word queries are automatically AND-joined unless explicit boolean operators (AND, OR, NOT) are present.'),
    page: z.number().optional().describe('Page number'),
    ...dateFilterSchema,
  },
  async ({ status = 'all', mailbox, tag, assignedTo, query, page, createdSince, createdBefore, modifiedSince, modifiedBefore }) => {
    const normalizedQuery = normalizeSearchQuery(query);
    const dateQuery = buildDateQuery({ createdSince, createdBefore, modifiedSince, modifiedBefore }, normalizedQuery);
    return jsonResponse(cleanForMcp(await client.listConversations({ status, mailbox, tag, assignedTo, query: dateQuery, page })));
  }
);

server.tool(
  'get_conversation',
  'Get detailed information about a specific conversation including threads. Threads are capped by maxThreads (default 20), keeping the original message and most recent threads.',
  {
    conversationId: z.number().describe('Conversation ID'),
    includeThreads: z.boolean().optional().describe('Include conversation threads'),
    maxThreads: z.number().optional().default(DEFAULT_MAX_THREADS).describe('Maximum threads to return (default 20). Keeps original message + most recent.'),
  },
  async ({ conversationId, includeThreads, maxThreads }) => {
    const conversation = await client.getConversation(conversationId);
    const cleaned = cleanForMcp(conversation);
    if (includeThreads) {
      const threads = await client.getConversationThreads(conversationId);
      return jsonResponse({ ...(cleaned as Record<string, unknown>), ...capThreads(threads, maxThreads) });
    }
    return jsonResponse(cleaned);
  }
);

server.tool(
  'search_conversations',
  'Search conversations matching a query. Results are capped by maxResults (default 25). If results are truncated, use date filters or more specific search terms to narrow. WARNING: Compound filters are unreliable — use one filter per call.',
  {
    query: z.string().optional().describe('Search query (e.g., "email:domain.com", "subject:billing"). Compound queries mixing a prefix filter with keywords are unreliable — make separate calls for each filter.'),
    status: z.enum(['active', 'pending', 'closed', 'spam', 'all']).optional().describe('Status filter (defaults to "all")'),
    maxResults: z.number().optional().default(DEFAULT_MAX_RESULTS).describe('Maximum conversations to return (default 25). Use date filters to narrow large result sets.'),
    ...dateFilterSchema,
  },
  async ({ query, status = 'all', maxResults, createdSince, createdBefore, modifiedSince, modifiedBefore }) => {
    const normalizedQuery = normalizeSearchQuery(query);
    const dateQuery = buildDateQuery({ createdSince, createdBefore, modifiedSince, modifiedBefore }, normalizedQuery);
    const all = await client.listAllConversations({ query: dateQuery, status }, maxResults);
    return jsonResponse(withOmissionMeta(all, maxResults));
  }
);

server.tool(
  'get_conversations_summary',
  'Get aggregated summary of conversations by status and tag. Fetches up to maxResults conversations (default 25) for summarization. Use date filters to scope the window.',
  {
    status: z.enum(['active', 'pending', 'closed', 'spam', 'all']).optional().describe('Status filter'),
    mailbox: z.string().optional().describe('Mailbox ID to filter by'),
    tag: z.string().optional().describe('Tag to filter by'),
    maxResults: z.number().optional().default(DEFAULT_MAX_RESULTS).describe('Maximum conversations to summarize (default 25)'),
    ...dateFilterSchema,
  },
  async ({ status, mailbox, tag, maxResults, createdSince, createdBefore, modifiedSince, modifiedBefore }) => {
    const dateQuery = buildDateQuery({ createdSince, createdBefore, modifiedSince, modifiedBefore });
    const conversations = await client.listAllConversations({ status, mailbox, tag, query: dateQuery }, maxResults);
    return jsonResponse(summarizeConversations(conversations));
  }
);

server.tool('list_mailboxes', 'List all mailboxes in the Help Scout account', {}, async () =>
  jsonResponse(await client.listMailboxes())
);

server.tool(
  'get_mailbox',
  'Get detailed information about a specific mailbox',
  { mailboxId: z.number().describe('Mailbox ID') },
  async ({ mailboxId }) => jsonResponse(await client.getMailbox(mailboxId))
);

server.tool(
  'list_customers',
  'List customers with optional filtering',
  {
    query: z.string().optional().describe('Search query'),
    firstName: z.string().optional().describe('Filter by first name'),
    lastName: z.string().optional().describe('Filter by last name'),
    page: z.number().optional().describe('Page number'),
  },
  async ({ query, firstName, lastName, page }) =>
    jsonResponse(await client.listCustomers({ query, firstName, lastName, page }))
);

server.tool(
  'get_customer',
  'Get detailed information about a specific customer',
  { customerId: z.number().describe('Customer ID') },
  async ({ customerId }) => jsonResponse(await client.getCustomer(customerId))
);

server.tool(
  'list_tags',
  'List all tags in the Help Scout account',
  { page: z.number().optional().describe('Page number') },
  async ({ page }) => jsonResponse(await client.listTags(page))
);

server.tool(
  'list_workflows',
  'List workflows with optional filtering',
  {
    mailbox: z.number().optional().describe('Mailbox ID to filter by'),
    type: z.enum(['automatic', 'manual']).optional().describe('Workflow type'),
    page: z.number().optional().describe('Page number'),
  },
  async ({ mailbox, type, page }) => jsonResponse(await client.listWorkflows({ mailbox, type, page }))
);

server.tool(
  'create_note',
  'Add a private note to a conversation',
  {
    conversationId: z.number().describe('Conversation ID'),
    text: z.string().describe('Note text content'),
  },
  async ({ conversationId, text }) => {
    await client.createNote(conversationId, { text });
    return jsonResponse({ success: true });
  }
);

server.tool(
  'create_draft',
  'Create a draft reply on a conversation (saves without sending)',
  {
    conversationId: z.number().describe('Conversation ID'),
    text: z.string().describe('Draft reply text content'),
  },
  async ({ conversationId, text }) => {
    await client.createReply(conversationId, { text, draft: true });
    return jsonResponse({ success: true });
  }
);

server.tool(
  'add_tag',
  'Add a tag to a conversation',
  {
    conversationId: z.number().describe('Conversation ID'),
    tag: z.string().describe('Tag name to add'),
  },
  async ({ conversationId, tag }) => {
    await client.addConversationTag(conversationId, tag);
    return jsonResponse({ success: true });
  }
);

server.tool(
  'search_by_customer',
  "Find conversations involving a customer by email. Searches primary email and domain (for CC'd/teammate tickets). Results deduplicated and capped by maxResults (default 25). Use date filters to narrow large result sets.",
  {
    email: z.string().email().describe('Customer email address'),
    status: z.enum(['active', 'pending', 'closed', 'spam', 'all']).optional().describe('Status filter (defaults to "all")'),
    maxResults: z.number().optional().default(DEFAULT_MAX_RESULTS).describe('Maximum conversations to return (default 25)'),
    ...dateFilterSchema,
  },
  async ({ email, status = 'all', maxResults, createdSince, createdBefore, modifiedSince, modifiedBefore }) => {
    const domain = email.split('@')[1];
    const dateFilters = { createdSince, createdBefore, modifiedSince, modifiedBefore };

    const emailQuery = buildDateQuery(dateFilters, `email:${email}`);
    const emailSearch = client.listAllConversations({ query: emailQuery, status }, maxResults);

    const isGenericDomain = GENERIC_EMAIL_DOMAINS.has(domain);
    const domainSearch = isGenericDomain
      ? Promise.resolve([] as Conversation[])
      : client.listAllConversations({
          query: buildDateQuery(dateFilters, `@${domain}`),
          status,
        }, maxResults);

    const [emailResults, domainResults] = await Promise.all([emailSearch, domainSearch]);

    const seen = new Set<number>();
    const all: Conversation[] = [];

    for (const conv of emailResults) {
      seen.add(conv.id);
      all.push(conv);
    }
    for (const conv of domainResults) {
      if (!seen.has(conv.id)) {
        seen.add(conv.id);
        all.push(conv);
      }
    }

    return jsonResponse({
      ...withOmissionMeta(all, maxResults),
      meta: {
        email,
        domain,
        domainSearchSkipped: isGenericDomain,
        emailResults: emailResults.length,
        domainResults: domainResults.length,
        totalAfterDedup: all.length,
      },
    });
  }
);

server.tool('check_auth', 'Check if Help Scout authentication is configured', {}, async () =>
  jsonResponse({ authenticated: await auth.isAuthenticated() })
);

server.tool(
  'search_tools',
  'Search for available tools by name or description using regex. Returns matching tool names.',
  {
    query: z.string().describe('Regex pattern to match against tool names and descriptions (case-insensitive)'),
  },
  async ({ query }) => {
    try {
      const pattern = new RegExp(query, 'i');
      const matches = toolRegistry.filter((t) => pattern.test(t.name) || pattern.test(t.description));
      return jsonResponse({ tools: matches });
    } catch {
      return jsonResponse({ error: 'Invalid regex pattern' });
    }
  }
);

export async function runMcpServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
