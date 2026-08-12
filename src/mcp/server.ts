import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { client } from '../lib/api-client.js';
import { auth } from '../lib/auth.js';
import { downloadAttachmentToFile } from '../lib/attachment-download.js';
import { normalizeConversationStatus } from '../lib/conversation-status.js';
import { buildDateQuery } from '../lib/dates.js';
import { normalizeSearchQuery } from '../lib/search.js';
import { buildConversationThreadsResult } from './conversation-threads.js';
import type {
  Conversation,
  Customer,
  Mailbox,
  Tag,
  Thread,
  User,
  Workflow,
} from '../types/index.js';

declare const __VERSION__: string;
declare const __HOMEPAGE__: string;

const DEFAULT_MAX_RESULTS = 25;
const DEFAULT_MAX_THREADS = 20;

type JsonObject = Record<string, unknown>;
type ResourceLinkBlock = {
  type: 'resource_link';
  uri: string;
  name: string;
  description: string;
  mimeType: 'application/json';
};

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
    if (key === 'color' && Object.keys(obj).includes('name') && Object.keys(obj).includes('slug'))
      continue; // tag style
    if (key === 'styles' && Object.keys(obj).includes('name') && Object.keys(obj).includes('slug'))
      continue; // tag style

    // Strip zero-valued IDs (Help Scout placeholder convention)
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

function asRecord(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function normalizeConversation(conversation: Conversation): JsonObject {
  const cleaned = asRecord(cleanForMcp(conversation));

  if (typeof cleaned.threads === 'number') {
    const { threads, ...rest } = cleaned;
    return { ...rest, threadCount: threads };
  }

  return cleaned;
}

function normalizeConversations(conversations: Conversation[]) {
  return conversations.map(normalizeConversation);
}

function cleanCustomer(customer: Customer) {
  return asRecord(cleanForMcp(customer));
}

function cleanMailbox(mailbox: Mailbox) {
  return asRecord(cleanForMcp(mailbox));
}

function cleanTag(tag: Tag) {
  return asRecord(cleanForMcp(tag));
}

function cleanUser(user: User) {
  return asRecord(cleanForMcp(user));
}

function cleanWorkflow(workflow: Workflow) {
  return asRecord(cleanForMcp(workflow));
}

function jsonTextContent(data: unknown) {
  return {
    type: 'text' as const,
    text: JSON.stringify(data, null, 2),
  };
}

function resourceLinkContent(uri: string, name: string, description: string): ResourceLinkBlock {
  return {
    type: 'resource_link',
    uri,
    name,
    description,
    mimeType: 'application/json',
  };
}

function structuredJsonResult<T extends JsonObject>(
  structuredContent: T,
  extraContent: ResourceLinkBlock[] = []
) {
  return {
    content: [jsonTextContent(structuredContent), ...extraContent],
    structuredContent,
  };
}

function textJsonResult(data: unknown, isError = false) {
  return {
    content: [jsonTextContent(data)],
    ...(isError && { isError: true }),
  };
}

/** Wrap search results with omission metadata when capped. */
function withOmissionMeta(all: Conversation[], maxResults: number) {
  const total = all.length;
  const conversations = total > maxResults ? all.slice(0, maxResults) : all;
  return {
    conversations: normalizeConversations(conversations),
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

  const kept = maxThreads <= 1 ? [threads[0]] : [threads[0], ...threads.slice(-(maxThreads - 1))];

  return {
    threads: cleanForMcp(kept) as unknown[],
    total_threads: threads.length,
    returned_threads: kept.length,
    omitted_threads: threads.length - kept.length,
  };
}

async function getConversationDetail(
  conversationId: number,
  includeThreads = false,
  maxThreads = DEFAULT_MAX_THREADS
) {
  const conversation = await client.getConversation(conversationId);
  const detail: JsonObject = { conversation: normalizeConversation(conversation) };

  if (!includeThreads) {
    return detail;
  }

  const threads = await client.getConversationThreads(conversationId);
  return { ...detail, ...capThreads(threads, maxThreads) };
}

function buildJsonResource(uri: string, data: unknown) {
  return {
    contents: [
      {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

function parseTemplateNumber(value: unknown, variableName: string): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${variableName}: ${String(raw)}`);
  }

  return parsed;
}

function conversationResourceUri(conversationId: number) {
  return `helpscout://conversation/${conversationId}`;
}

function customerResourceUri(customerId: number) {
  return `helpscout://customer/${customerId}`;
}

function userResourceUri(userId: number) {
  return `helpscout://user/${userId}`;
}

const pageInfoSchema = z
  .object({
    size: z.number(),
    totalElements: z.number(),
    totalPages: z.number(),
    number: z.number(),
  })
  .passthrough();

const personSchema = z
  .object({
    id: z.number().optional(),
    type: z.string().optional(),
    email: z.string().optional(),
    name: z.string().optional(),
  })
  .passthrough();

const sourceSchema = z
  .object({
    type: z.string(),
    via: z.string(),
  })
  .passthrough();

const tagSchema = z
  .object({
    id: z.number().optional(),
    name: z.string().optional(),
    slug: z.string().optional(),
    tag: z.string().optional(),
    color: z.string().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    ticketCount: z.number().optional(),
  })
  .passthrough();

const customFieldSchema = z
  .object({
    id: z.number().optional(),
    name: z.string(),
    value: z.string(),
    type: z.string(),
  })
  .passthrough();

const conversationSchema = z
  .object({
    id: z.number(),
    number: z.number(),
    type: z.string(),
    folderId: z.number().optional(),
    status: z.string(),
    state: z.string(),
    subject: z.string(),
    preview: z.string(),
    mailboxId: z.number(),
    assignee: personSchema.optional(),
    createdBy: personSchema.optional(),
    createdAt: z.string(),
    closedAt: z.string().optional(),
    closedBy: z.number().optional(),
    modifiedAt: z.string().optional(),
    customerWaitingSince: z
      .object({
        time: z.string(),
        friendly: z.string(),
      })
      .passthrough()
      .optional(),
    source: sourceSchema.optional(),
    tags: z.array(tagSchema).optional(),
    cc: z.array(z.string()).optional(),
    bcc: z.array(z.string()).optional(),
    primaryCustomer: personSchema.optional(),
    customFields: z.array(customFieldSchema).optional(),
    threadCount: z.number().optional(),
  })
  .passthrough();

const threadSchema = z
  .object({
    id: z.number().optional(),
    type: z.string(),
    // Not present on every thread type (e.g. lineitem and other system-generated
    // threads omit them), so these are optional rather than required.
    status: z.string().optional(),
    state: z.string().optional(),
    action: z
      .object({
        type: z.string(),
        text: z.string().optional(),
      })
      .passthrough()
      .optional(),
    body: z.string().optional(),
    source: sourceSchema.optional(),
    customer: personSchema.optional(),
    createdBy: personSchema.optional(),
    assignedTo: personSchema.optional(),
    savedReplyId: z.number().optional(),
    to: z.array(z.string()).optional(),
    cc: z.array(z.string()).optional(),
    bcc: z.array(z.string()).optional(),
    createdAt: z.string(),
    openedAt: z.string().optional(),
  })
  .passthrough();

const customerSchema = z
  .object({
    id: z.number(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    gender: z.string().optional(),
    jobTitle: z.string().optional(),
    location: z.string().optional(),
    organization: z.string().optional(),
    photoType: z.string().optional(),
    background: z.string().optional(),
    age: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string().optional(),
    emails: z
      .array(
        z
          .object({
            id: z.number().optional(),
            value: z.string(),
            type: z.string(),
          })
          .passthrough()
      )
      .optional(),
    phones: z
      .array(
        z
          .object({
            id: z.number().optional(),
            value: z.string(),
            type: z.string(),
          })
          .passthrough()
      )
      .optional(),
    chats: z
      .array(
        z
          .object({
            id: z.number().optional(),
            value: z.string(),
            type: z.string(),
          })
          .passthrough()
      )
      .optional(),
    socialProfiles: z
      .array(
        z
          .object({
            id: z.number().optional(),
            value: z.string(),
            type: z.string(),
          })
          .passthrough()
      )
      .optional(),
    websites: z
      .array(
        z
          .object({
            id: z.number().optional(),
            value: z.string(),
          })
          .passthrough()
      )
      .optional(),
    addresses: z
      .array(
        z
          .object({
            id: z.number().optional(),
            city: z.string().optional(),
            state: z.string().optional(),
            postalCode: z.string().optional(),
            country: z.string().optional(),
            lines: z.array(z.string()).optional(),
          })
          .passthrough()
      )
      .optional(),
  })
  .passthrough();

const userSchema = z
  .object({
    id: z.number(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    email: z.string().optional(),
    role: z.string().optional(),
    timezone: z.string().optional(),
    createdAt: z.string().optional(),
    updatedAt: z.string().optional(),
    type: z.string().optional(),
    mention: z.string().optional(),
    initials: z.string().optional(),
    jobTitle: z.string().optional(),
    phone: z.string().optional(),
    alternateEmails: z.array(z.string()).optional(),
  })
  .passthrough();

const mailboxSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    slug: z.string(),
    email: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .passthrough();

const workflowSchema = z
  .object({
    id: z.number(),
    mailboxId: z.number(),
    type: z.string(),
    status: z.string(),
    order: z.number(),
    name: z.string(),
    createdAt: z.string(),
    modifiedAt: z.string(),
  })
  .passthrough();

const listConversationsOutputSchema = z.object({
  conversations: z.array(conversationSchema),
  page: pageInfoSchema,
});

const conversationDetailOutputSchema = z.object({
  conversation: conversationSchema,
  threads: z.array(threadSchema).optional(),
  total_threads: z.number().optional(),
  returned_threads: z.number().optional(),
  omitted_threads: z.number().optional(),
});

const conversationThreadsOutputSchema = z.object({
  conversationId: z.number(),
  threads: z.array(threadSchema),
  total_threads: z.number(),
  matching_threads: z.number(),
  returned_threads: z.number(),
  omitted_threads: z.number().optional(),
  filtered_types: z.array(z.string()).optional(),
});

const draftReplySchema = z.object({
  threadId: z.number(),
  conversationId: z.number(),
  type: z.literal('message'),
  state: z.literal('draft'),
  status: z.string().optional(),
  body: z.string(),
  preview: z.string(),
  createdAt: z.string(),
  createdBy: personSchema.optional(),
  to: z.array(z.string()).optional(),
  cc: z.array(z.string()).optional(),
  bcc: z.array(z.string()).optional(),
});

const listDraftRepliesOutputSchema = z.object({
  conversationId: z.number(),
  drafts: z.array(draftReplySchema),
  total: z.number(),
});

const draftReplyWriteOutputSchema = z.object({
  success: z.literal(true),
  conversationId: z.number(),
  threadId: z.number(),
  action: z.enum(['created', 'updated']),
  verified: z.literal(true),
  draft: draftReplySchema,
});

const attachmentDownloadOutputSchema = z.object({
  message: z.literal('Attachment downloaded'),
  conversationId: z.number(),
  attachmentId: z.number(),
  filename: z.string(),
  path: z.string(),
  bytes: z.number(),
  contentType: z.string().optional(),
});

const searchConversationsOutputSchema = z.object({
  conversations: z.array(conversationSchema),
  total_results: z.number().optional(),
  returned: z.number().optional(),
  omitted: z.number().optional(),
});

/**
 * Accepts either an internal conversation id or a visible ticket number
 * prefixed with "#" (e.g. "#12345"). Resolved to an internal id via
 * client.resolveConversationId() before use.
 */
const conversationRefSchema = z
  .union([z.number().int().positive(), z.string().min(1)])
  .describe(
    'Conversation ID (internal numeric id), or visible ticket number prefixed with "#" (e.g. "#12345")'
  );

const searchByCustomerOutputSchema = searchConversationsOutputSchema.extend({
  meta: z.object({
    email: z.string(),
    domain: z.string(),
    domainSearchSkipped: z.boolean(),
    emailResults: z.number(),
    domainResults: z.number(),
    totalAfterDedup: z.number(),
  }),
});

const conversationSummaryOutputSchema = z.object({
  total: z.number(),
  byStatus: z.record(z.string(), z.number()),
  byTag: z.record(z.string(), z.number()),
});

const listMailboxesOutputSchema = z.object({
  mailboxes: z.array(mailboxSchema),
  page: pageInfoSchema,
});

const listCustomersOutputSchema = z.object({
  customers: z.array(customerSchema),
  page: pageInfoSchema,
});

const listUsersOutputSchema = z.object({
  users: z.array(userSchema),
  page: pageInfoSchema,
});

const listTagsOutputSchema = z.object({
  tags: z.array(tagSchema),
  page: pageInfoSchema,
});

const listWorkflowsOutputSchema = z.object({
  workflows: z.array(workflowSchema),
  page: pageInfoSchema,
});

const authStatusOutputSchema = z.object({
  authenticated: z.boolean(),
});

const conversationActionOutputSchema = z.object({
  success: z.literal(true),
  conversationId: z.number(),
});

const conversationStatusOutputSchema = conversationActionOutputSchema.extend({
  status: z.enum(['active', 'pending', 'closed', 'spam']),
});

const noteOutputSchema = conversationActionOutputSchema.extend({
  status: z.enum(['active', 'pending', 'closed', 'spam']).optional(),
});

const taggedConversationOutputSchema = conversationActionOutputSchema.extend({
  tag: z.string(),
});

const draftConversationOutputSchema = z.object({
  success: z.literal(true),
  conversationId: z.number(),
});

const READ_ONLY_REMOTE_ANNOTATIONS = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: true,
};

const READ_ONLY_LOCAL_ANNOTATIONS = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

const MUTATING_REMOTE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

const MUTATING_LOCAL_REMOTE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

const toolRegistry: Array<{ name: string; description: string }> = [];

type ConversationSummary = JsonObject & {
  total: number;
  byStatus: Record<string, number>;
  byTag: Record<string, number>;
};

function summarizeConversations(conversations: Conversation[]): ConversationSummary {
  const byStatus: Record<string, number> = {};
  const byTag: Record<string, number> = {};

  for (const conv of conversations) {
    byStatus[conv.status] = (byStatus[conv.status] || 0) + 1;
    for (const tag of conv.tags || []) {
      const label = tag.name ?? (tag as { tag?: string }).tag ?? 'unknown';
      byTag[label] = (byTag[label] || 0) + 1;
    }
  }

  return { total: conversations.length, byStatus, byTag };
}

const server = new McpServer({
  name: 'helpscout',
  version: __VERSION__,
  ...(__HOMEPAGE__ ? { websiteUrl: __HOMEPAGE__ } : {}),
  description: 'Help Scout MCP server for mailbox, customer, tag, and workflow operations.',
});

function rememberTool(name: string, description: string) {
  toolRegistry.push({ name, description });
}

export function getRegisteredToolsForTesting() {
  return [...toolRegistry];
}

/** Exposed for tests guarding the thread output schema against over-strict nesting. */
export function getThreadSchemaForTesting() {
  return threadSchema;
}

/** Exposed for tests guarding the MCP draft lifecycle output contract. */
export function getDraftReplySchemasForTesting() {
  return { draftReplySchema, listDraftRepliesOutputSchema, draftReplyWriteOutputSchema };
}

const dateFilterSchema = {
  createdSince: z
    .string()
    .optional()
    .describe(
      'Filter by creation date — returns only conversations created after this date. Does not include older conversations with recent activity; use modifiedSince for that.'
    ),
  createdBefore: z
    .string()
    .optional()
    .describe('Filter by creation date — returns only conversations created before this date'),
  modifiedSince: z
    .string()
    .optional()
    .describe(
      'Filter by last activity date — returns conversations with ANY activity (replies, notes, status changes, tag changes) after this date, including old conversations. Use createdSince to filter by creation date instead.'
    ),
  modifiedBefore: z
    .string()
    .optional()
    .describe(
      'Filter by last activity date — returns conversations with last activity before this date'
    ),
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

server.registerResource(
  'conversation-resource',
  new ResourceTemplate('helpscout://conversation/{conversationId}', { list: undefined }),
  {
    title: 'Help Scout Conversation',
    description: 'Detailed Help Scout conversation JSON, including capped threads.',
    mimeType: 'application/json',
  },
  async (uri, variables) => {
    const conversationId = parseTemplateNumber(variables.conversationId, 'conversationId');
    const detail = await getConversationDetail(conversationId, true, DEFAULT_MAX_THREADS);
    return buildJsonResource(uri.toString(), detail);
  }
);

server.registerResource(
  'customer-resource',
  new ResourceTemplate('helpscout://customer/{customerId}', { list: undefined }),
  {
    title: 'Help Scout Customer',
    description: 'Detailed Help Scout customer JSON.',
    mimeType: 'application/json',
  },
  async (uri, variables) => {
    const customerId = parseTemplateNumber(variables.customerId, 'customerId');
    const customer = cleanCustomer(await client.getCustomer(customerId));
    return buildJsonResource(uri.toString(), customer);
  }
);

server.registerResource(
  'user-resource',
  new ResourceTemplate('helpscout://user/{userId}', { list: undefined }),
  {
    title: 'Help Scout User',
    description: 'Detailed Help Scout user JSON, including mention handle when available.',
    mimeType: 'application/json',
  },
  async (uri, variables) => {
    const userId = parseTemplateNumber(variables.userId, 'userId');
    const user = cleanUser(await client.getUser(userId));
    return buildJsonResource(uri.toString(), user);
  }
);

server.registerPrompt(
  'summarize_ticket',
  {
    title: 'Summarize Ticket',
    description: 'Generate an internal summary of a Help Scout conversation.',
    argsSchema: {
      conversationId: z.number().describe('Conversation ID to summarize'),
      focus: z
        .string()
        .optional()
        .describe('Optional area to emphasize, such as billing, bugs, or customer sentiment'),
      maxThreads: z
        .number()
        .optional()
        .default(DEFAULT_MAX_THREADS)
        .describe('Maximum threads to include in the prompt context (default 20)'),
    },
  },
  async ({ conversationId, focus, maxThreads }) => {
    const detail = await getConversationDetail(conversationId, true, maxThreads);
    const instructions = [
      'Summarize this Help Scout conversation for an internal support teammate.',
      focus
        ? `Focus especially on: ${focus}.`
        : 'Focus on the customer issue, the current status, unresolved questions, and the next recommended action.',
      'Do not draft a reply to the customer.',
      `Conversation resource URI: ${conversationResourceUri(conversationId)}`,
      'Conversation JSON:',
      JSON.stringify(detail, null, 2),
    ].join('\n\n');

    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: instructions,
          },
        },
      ],
    };
  }
);

server.registerPrompt(
  'draft_reply',
  {
    title: 'Draft Reply',
    description: 'Draft a customer-facing reply from a Help Scout conversation.',
    argsSchema: {
      conversationId: z.number().describe('Conversation ID to reply to'),
      tone: z
        .string()
        .optional()
        .describe('Desired tone, such as concise, warm, direct, or apologetic'),
      goal: z
        .string()
        .optional()
        .describe(
          'Specific reply goal, such as resolving billing confusion or asking for a reproduction'
        ),
      maxThreads: z
        .number()
        .optional()
        .default(DEFAULT_MAX_THREADS)
        .describe('Maximum threads to include in the prompt context (default 20)'),
    },
  },
  async ({ conversationId, tone, goal, maxThreads }) => {
    const detail = await getConversationDetail(conversationId, true, maxThreads);
    const instructions = [
      'Draft a Help Scout reply to the customer using the conversation data below.',
      tone ? `Tone: ${tone}.` : 'Tone: clear, professional, and empathetic.',
      goal
        ? `Primary goal: ${goal}.`
        : 'Primary goal: move the conversation toward a clear next step.',
      'Do not claim the message has already been sent.',
      `Conversation resource URI: ${conversationResourceUri(conversationId)}`,
      'Conversation JSON:',
      JSON.stringify(detail, null, 2),
    ].join('\n\n');

    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: instructions,
          },
        },
      ],
    };
  }
);

rememberTool(
  'list_conversations',
  'List conversations with optional filtering by status, mailbox, tag, assignee, or date range'
);
server.registerTool(
  'list_conversations',
  {
    title: 'List Conversations',
    description:
      'List conversations with optional filtering by status, mailbox, tag, assignee, or date range',
    inputSchema: {
      status: z
        .enum(['active', 'pending', 'closed', 'spam', 'all'])
        .optional()
        .describe('Conversation status filter (defaults to "all" to include resolved tickets)'),
      mailbox: z.string().optional().describe('Mailbox ID to filter by'),
      tag: z.string().optional().describe('Tag to filter by'),
      assignedTo: z.string().optional().describe('User ID assigned to'),
      query: z
        .string()
        .optional()
        .describe(
          'Search query. Multi-word queries are automatically AND-joined unless explicit boolean operators (AND, OR, NOT) are present.'
        ),
      page: z.number().optional().describe('Page number'),
      ...dateFilterSchema,
    },
    outputSchema: listConversationsOutputSchema,
    annotations: READ_ONLY_REMOTE_ANNOTATIONS,
  },
  async ({
    status = 'all',
    mailbox,
    tag,
    assignedTo,
    query,
    page,
    createdSince,
    createdBefore,
    modifiedSince,
    modifiedBefore,
  }) => {
    const normalizedQuery = normalizeSearchQuery(query);
    const dateQuery = buildDateQuery(
      { createdSince, createdBefore, modifiedSince, modifiedBefore },
      normalizedQuery
    );
    const result = await client.listConversations({
      status,
      mailbox,
      tag,
      assignedTo,
      query: dateQuery,
      page,
    });

    return structuredJsonResult({
      conversations: normalizeConversations(result.conversations),
      page: result.page,
    });
  }
);

rememberTool(
  'get_conversation',
  'Get detailed information about a specific conversation. When includeThreads is true, the result includes capped threads as a separate array.'
);
server.registerTool(
  'get_conversation',
  {
    title: 'Get Conversation',
    description:
      'Get detailed information about a specific conversation. When includeThreads is true, the result includes capped threads as a separate array.',
    inputSchema: {
      conversationId: conversationRefSchema,
      includeThreads: z.boolean().optional().describe('Include conversation threads'),
      maxThreads: z
        .number()
        .optional()
        .default(DEFAULT_MAX_THREADS)
        .describe('Maximum threads to return (default 20). Keeps original message + most recent.'),
    },
    outputSchema: conversationDetailOutputSchema,
    annotations: READ_ONLY_REMOTE_ANNOTATIONS,
  },
  async ({ conversationId: conversationRef, includeThreads = false, maxThreads }) => {
    const conversationId = await client.resolveConversationId(conversationRef);
    const detail = await getConversationDetail(conversationId, includeThreads, maxThreads);

    return structuredJsonResult(detail, [
      resourceLinkContent(
        conversationResourceUri(conversationId),
        `Conversation ${conversationId}`,
        'Detailed Help Scout conversation resource'
      ),
    ]);
  }
);

rememberTool(
  'get_conversation_threads',
  'Get the full thread history for a conversation, including notes, workflow events, status events, and other system thread types returned by Help Scout. Accepts internal ids or visible ticket numbers like "#12345".'
);
server.registerTool(
  'get_conversation_threads',
  {
    title: 'Get Conversation Threads',
    description:
      'Get the full thread history for a conversation, including notes, workflow events, status events, and other system thread types returned by Help Scout. Accepts internal ids or visible ticket numbers like "#12345".',
    inputSchema: {
      conversationId: conversationRefSchema,
      types: z
        .array(z.string())
        .optional()
        .describe(
          'Optional thread type filter, such as ["customer", "message", "note", "lineitem"]. Omit to return all thread types.'
        ),
      maxThreads: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Optional cap on returned threads. Omit for full history.'),
    },
    outputSchema: conversationThreadsOutputSchema,
    annotations: READ_ONLY_REMOTE_ANNOTATIONS,
  },
  async ({ conversationId: conversationRef, types, maxThreads }) => {
    const conversationId = await client.resolveConversationId(conversationRef);
    const threads = await client.getConversationThreads(conversationId);

    return structuredJsonResult(
      buildConversationThreadsResult(conversationId, threads, {
        types,
        maxThreads,
        cleanThreads: (items) => cleanForMcp(items) as unknown[],
      }),
      [
        resourceLinkContent(
          conversationResourceUri(conversationId),
          `Conversation ${conversationId}`,
          'Detailed Help Scout conversation resource'
        ),
      ]
    );
  }
);

rememberTool(
  'download_attachment',
  'Download a conversation attachment from Help Scout to a local file. Fails if the file exists unless force is true.'
);
server.registerTool(
  'download_attachment',
  {
    title: 'Download Attachment',
    description:
      'Download a conversation attachment from Help Scout to a local file. If outputPath is omitted, saves to the attachment filename in the current working directory. If outputPath is an existing directory or ends with a path separator, saves into that directory using the attachment filename. Fails if the file exists unless force is true.',
    inputSchema: {
      conversationId: conversationRefSchema,
      attachmentId: z.number().int().positive().describe('Help Scout attachment ID'),
      outputPath: z
        .string()
        .optional()
        .describe(
          'Optional destination file or directory path. Directories use the attachment filename.'
        ),
      force: z
        .boolean()
        .optional()
        .default(false)
        .describe('Overwrite the destination file if it already exists'),
    },
    outputSchema: attachmentDownloadOutputSchema,
    annotations: MUTATING_LOCAL_REMOTE_ANNOTATIONS,
  },
  async ({ conversationId: conversationRef, attachmentId, outputPath, force = false }) => {
    const result = await downloadAttachmentToFile(String(conversationRef), String(attachmentId), {
      output: outputPath,
      force,
    });

    return structuredJsonResult({ ...result });
  }
);

rememberTool(
  'search_conversations',
  'Search conversations matching a query. Results are capped by maxResults (default 25). If results are truncated, use date filters or more specific search terms to narrow. WARNING: Compound filters are unreliable — use one filter per call.'
);
server.registerTool(
  'search_conversations',
  {
    title: 'Search Conversations',
    description:
      'Search conversations matching a query. Results are capped by maxResults (default 25). If results are truncated, use date filters or more specific search terms to narrow. WARNING: Compound filters are unreliable — use one filter per call.',
    inputSchema: {
      query: z
        .string()
        .optional()
        .describe(
          'Search query (e.g., "email:domain.com", "subject:billing"). Compound queries mixing a prefix filter with keywords are unreliable — make separate calls for each filter.'
        ),
      status: z
        .enum(['active', 'pending', 'closed', 'spam', 'all'])
        .optional()
        .describe('Status filter (defaults to "all")'),
      maxResults: z
        .number()
        .optional()
        .default(DEFAULT_MAX_RESULTS)
        .describe(
          'Maximum conversations to return (default 25). Use date filters to narrow large result sets.'
        ),
      ...dateFilterSchema,
    },
    outputSchema: searchConversationsOutputSchema,
    annotations: READ_ONLY_REMOTE_ANNOTATIONS,
  },
  async ({
    query,
    status = 'all',
    maxResults,
    createdSince,
    createdBefore,
    modifiedSince,
    modifiedBefore,
  }) => {
    const normalizedQuery = normalizeSearchQuery(query);
    const dateQuery = buildDateQuery(
      { createdSince, createdBefore, modifiedSince, modifiedBefore },
      normalizedQuery
    );
    const all = await client.listAllConversations({ query: dateQuery, status }, maxResults);
    return structuredJsonResult(withOmissionMeta(all, maxResults));
  }
);

rememberTool(
  'get_conversations_summary',
  'Get aggregated summary of conversations by status and tag. Fetches up to maxResults conversations (default 25) for summarization. Use date filters to scope the window.'
);
server.registerTool(
  'get_conversations_summary',
  {
    title: 'Summarize Conversations',
    description:
      'Get aggregated summary of conversations by status and tag. Fetches up to maxResults conversations (default 25) for summarization. Use date filters to scope the window.',
    inputSchema: {
      status: z
        .enum(['active', 'pending', 'closed', 'spam', 'all'])
        .optional()
        .describe('Status filter'),
      mailbox: z.string().optional().describe('Mailbox ID to filter by'),
      tag: z.string().optional().describe('Tag to filter by'),
      maxResults: z
        .number()
        .optional()
        .default(DEFAULT_MAX_RESULTS)
        .describe('Maximum conversations to summarize (default 25)'),
      ...dateFilterSchema,
    },
    outputSchema: conversationSummaryOutputSchema,
    annotations: READ_ONLY_REMOTE_ANNOTATIONS,
  },
  async ({
    status,
    mailbox,
    tag,
    maxResults,
    createdSince,
    createdBefore,
    modifiedSince,
    modifiedBefore,
  }) => {
    const dateQuery = buildDateQuery({
      createdSince,
      createdBefore,
      modifiedSince,
      modifiedBefore,
    });
    const conversations = await client.listAllConversations(
      { status, mailbox, tag, query: dateQuery },
      maxResults
    );
    return structuredJsonResult(summarizeConversations(conversations));
  }
);

rememberTool('list_mailboxes', 'List all mailboxes in the Help Scout account');
server.registerTool(
  'list_mailboxes',
  {
    title: 'List Mailboxes',
    description: 'List all mailboxes in the Help Scout account',
    outputSchema: listMailboxesOutputSchema,
    annotations: READ_ONLY_REMOTE_ANNOTATIONS,
  },
  async () => {
    const result = await client.listMailboxes();
    return structuredJsonResult({
      mailboxes: result.mailboxes.map(cleanMailbox),
      page: result.page,
    });
  }
);

rememberTool('get_mailbox', 'Get detailed information about a specific mailbox');
server.registerTool(
  'get_mailbox',
  {
    title: 'Get Mailbox',
    description: 'Get detailed information about a specific mailbox',
    inputSchema: {
      mailboxId: z.number().describe('Mailbox ID'),
    },
    outputSchema: mailboxSchema,
    annotations: READ_ONLY_REMOTE_ANNOTATIONS,
  },
  async ({ mailboxId }) => structuredJsonResult(cleanMailbox(await client.getMailbox(mailboxId)))
);

rememberTool('list_customers', 'List customers with optional filtering');
server.registerTool(
  'list_customers',
  {
    title: 'List Customers',
    description: 'List customers with optional filtering',
    inputSchema: {
      query: z.string().optional().describe('Search query'),
      firstName: z.string().optional().describe('Filter by first name'),
      lastName: z.string().optional().describe('Filter by last name'),
      page: z.number().optional().describe('Page number'),
    },
    outputSchema: listCustomersOutputSchema,
    annotations: READ_ONLY_REMOTE_ANNOTATIONS,
  },
  async ({ query, firstName, lastName, page }) => {
    const result = await client.listCustomers({ query, firstName, lastName, page });
    return structuredJsonResult({
      customers: result.customers.map(cleanCustomer),
      page: result.page,
    });
  }
);

rememberTool('get_customer', 'Get detailed information about a specific customer');
server.registerTool(
  'get_customer',
  {
    title: 'Get Customer',
    description: 'Get detailed information about a specific customer',
    inputSchema: {
      customerId: z.number().describe('Customer ID'),
    },
    outputSchema: customerSchema,
    annotations: READ_ONLY_REMOTE_ANNOTATIONS,
  },
  async ({ customerId }) => {
    const customer = cleanCustomer(await client.getCustomer(customerId));

    return structuredJsonResult(customer, [
      resourceLinkContent(
        customerResourceUri(customerId),
        `Customer ${customerId}`,
        'Detailed Help Scout customer resource'
      ),
    ]);
  }
);

rememberTool(
  'list_users',
  'List Help Scout users and mention handles with optional exact email, mailbox, and page filters'
);
server.registerTool(
  'list_users',
  {
    title: 'List Users',
    description:
      'List Help Scout users and mention handles with optional exact email, mailbox, and page filters',
    inputSchema: {
      email: z.string().email().optional().describe('Exact-match email filter'),
      mailbox: z.number().optional().describe('Mailbox ID to filter by'),
      page: z.number().optional().describe('Page number'),
    },
    outputSchema: listUsersOutputSchema,
    annotations: READ_ONLY_REMOTE_ANNOTATIONS,
  },
  async ({ email, mailbox, page }) => {
    const result = await client.listUsers({ email, mailbox, page });
    return structuredJsonResult({
      users: result.users.map(cleanUser),
      page: result.page,
    });
  }
);

rememberTool(
  'get_user',
  'Get detailed information about a specific Help Scout user, including the mention handle for @mentions'
);
server.registerTool(
  'get_user',
  {
    title: 'Get User',
    description:
      'Get detailed information about a specific Help Scout user, including the mention handle for @mentions',
    inputSchema: {
      userId: z.number().describe('User ID'),
    },
    outputSchema: userSchema,
    annotations: READ_ONLY_REMOTE_ANNOTATIONS,
  },
  async ({ userId }) => {
    const user = cleanUser(await client.getUser(userId));

    return structuredJsonResult(user, [
      resourceLinkContent(
        userResourceUri(userId),
        `User ${userId}`,
        'Detailed Help Scout user resource'
      ),
    ]);
  }
);

rememberTool('list_tags', 'List all tags in the Help Scout account');
server.registerTool(
  'list_tags',
  {
    title: 'List Tags',
    description: 'List all tags in the Help Scout account',
    inputSchema: {
      page: z.number().optional().describe('Page number'),
    },
    outputSchema: listTagsOutputSchema,
    annotations: READ_ONLY_REMOTE_ANNOTATIONS,
  },
  async ({ page }) => {
    const result = await client.listTags(page);
    return structuredJsonResult({
      tags: result.tags.map(cleanTag),
      page: result.page,
    });
  }
);

rememberTool('list_workflows', 'List workflows with optional filtering');
server.registerTool(
  'list_workflows',
  {
    title: 'List Workflows',
    description: 'List workflows with optional filtering',
    inputSchema: {
      mailbox: z.number().optional().describe('Mailbox ID to filter by'),
      type: z.enum(['automatic', 'manual']).optional().describe('Workflow type'),
      page: z.number().optional().describe('Page number'),
    },
    outputSchema: listWorkflowsOutputSchema,
    annotations: READ_ONLY_REMOTE_ANNOTATIONS,
  },
  async ({ mailbox, type, page }) => {
    const result = await client.listWorkflows({ mailbox, type, page });
    return structuredJsonResult({
      workflows: result.workflows.map(cleanWorkflow),
      page: result.page,
    });
  }
);

rememberTool('create_note', 'Add a private note to a conversation');
server.registerTool(
  'create_note',
  {
    title: 'Create Note',
    description: 'Add a private note to a conversation',
    inputSchema: {
      conversationId: conversationRefSchema,
      text: z.string().describe('Note text content'),
      status: z
        .string()
        .optional()
        .describe(
          'Optionally set the conversation status after adding the note (active, open, pending, closed, spam)'
        ),
    },
    outputSchema: noteOutputSchema,
    annotations: MUTATING_REMOTE_ANNOTATIONS,
  },
  async ({ conversationId: conversationRef, text, status }) => {
    const conversationId = await client.resolveConversationId(conversationRef);
    const normalizedStatus = status ? normalizeConversationStatus(status) : undefined;
    await client.createNote(conversationId, { text, status: normalizedStatus });
    return structuredJsonResult({
      success: true,
      conversationId,
      ...(normalizedStatus && { status: normalizedStatus }),
    });
  }
);

rememberTool(
  'list_draft_replies',
  'List active unsent draft replies for a conversation, including thread IDs, body previews, and author metadata.'
);
server.registerTool(
  'list_draft_replies',
  {
    title: 'List Draft Replies',
    description:
      'List active unsent draft replies for a conversation, including thread IDs, body previews, and author metadata. This tool never sends or changes anything.',
    inputSchema: { conversationId: conversationRefSchema },
    outputSchema: listDraftRepliesOutputSchema,
    annotations: READ_ONLY_REMOTE_ANNOTATIONS,
  },
  async ({ conversationId: conversationRef }) => {
    const conversationId = await client.resolveConversationId(conversationRef);
    const drafts = await client.listDraftReplies(conversationId);
    return structuredJsonResult({ conversationId, drafts, total: drafts.length });
  }
);

rememberTool(
  'create_draft_reply',
  'Create an additional draft reply on an existing conversation and verify its returned thread ID (saves without sending). Prefer upsert_draft_reply when duplicate drafts are not intended.'
);
server.registerTool(
  'create_draft_reply',
  {
    title: 'Create Draft Reply',
    description:
      'Create an additional draft reply on an existing conversation and verify its returned Resource-ID thread (saves without sending). Prefer upsert_draft_reply when duplicate drafts are not intended. This tool cannot publish or send.',
    inputSchema: {
      conversationId: conversationRefSchema,
      text: z.string().describe('Draft reply text content (HTML or plain text)'),
    },
    outputSchema: draftReplyWriteOutputSchema,
    annotations: MUTATING_REMOTE_ANNOTATIONS,
  },
  async ({ conversationId: conversationRef, text }) => {
    const conversationId = await client.resolveConversationId(conversationRef);
    const result = await client.createDraftReply(conversationId, { text });
    return structuredJsonResult({ success: true, ...result });
  }
);

rememberTool(
  'update_draft_reply',
  'Update one explicitly identified unsent draft reply in place and verify the final text. Refuses non-draft threads and never sends.'
);
server.registerTool(
  'update_draft_reply',
  {
    title: 'Update Draft Reply',
    description:
      'Update one explicitly identified unsent draft reply in place and verify the final text. Refuses missing, published, or non-reply threads. This tool cannot publish or send.',
    inputSchema: {
      conversationId: conversationRefSchema,
      threadId: z.number().int().positive().describe('Existing draft reply thread ID'),
      text: z.string().describe('Replacement draft text (HTML or plain text)'),
    },
    outputSchema: draftReplyWriteOutputSchema,
    annotations: MUTATING_REMOTE_ANNOTATIONS,
  },
  async ({ conversationId: conversationRef, threadId, text }) => {
    const conversationId = await client.resolveConversationId(conversationRef);
    const result = await client.updateDraftReply(conversationId, threadId, text);
    return structuredJsonResult({ success: true, ...result });
  }
);

rememberTool(
  'upsert_draft_reply',
  'Safely update the sole active draft reply or create one when none exists. Refuses multiple drafts unless threadId explicitly selects one; never sends.'
);
server.registerTool(
  'upsert_draft_reply',
  {
    title: 'Upsert Draft Reply',
    description:
      'Safely update the sole active draft reply or create one when none exists. Refuses to choose among multiple drafts unless threadId explicitly selects one. Verifies the final text and cannot publish or send.',
    inputSchema: {
      conversationId: conversationRefSchema,
      text: z.string().describe('Desired draft text (HTML or plain text)'),
      threadId: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Explicit draft thread ID, required only to disambiguate multiple drafts'),
    },
    outputSchema: draftReplyWriteOutputSchema,
    annotations: MUTATING_REMOTE_ANNOTATIONS,
  },
  async ({ conversationId: conversationRef, text, threadId }) => {
    const conversationId = await client.resolveConversationId(conversationRef);
    const result = await client.upsertDraftReply(conversationId, { text, threadId });
    return structuredJsonResult({ success: true, ...result });
  }
);

rememberTool(
  'create_draft_conversation',
  'Create a brand-new outbound draft conversation for proactive customer outreach (saves without sending). Use this when starting a new ticket from scratch — the draft is reviewed and sent from the Help Scout UI. For replying to an existing conversation, use create_draft_reply instead.'
);
server.registerTool(
  'create_draft_conversation',
  {
    title: 'Create Draft Conversation',
    description:
      'Create a brand-new outbound draft conversation for proactive customer outreach (saves without sending). Use this when starting a new ticket from scratch — the draft is reviewed and sent from the Help Scout UI. For replying to an existing conversation, use create_draft_reply instead.',
    inputSchema: {
      mailboxId: z.number().describe('Mailbox ID to create the conversation in'),
      customerEmail: z.string().email().describe('Recipient customer email address'),
      subject: z.string().describe('Conversation subject line'),
      text: z.string().describe('Draft message body (HTML or plain text)'),
      type: z
        .enum(['email', 'chat', 'phone'])
        .optional()
        .describe('Conversation medium (default "email")'),
      status: z
        .enum(['active', 'pending', 'closed'])
        .optional()
        .describe('Conversation status (default "active")'),
      tags: z.array(z.string()).optional().describe('Tags to apply to the conversation'),
    },
    outputSchema: draftConversationOutputSchema,
    annotations: MUTATING_REMOTE_ANNOTATIONS,
  },
  async ({ mailboxId, customerEmail, subject, text, type, status, tags }) => {
    const result = await client.createDraftConversation({
      mailboxId,
      customerEmail,
      subject,
      text,
      type,
      status,
      tags,
    });
    return structuredJsonResult({ success: true, conversationId: result.id });
  }
);

rememberTool(
  'update_conversation_status',
  'Change the status of an existing conversation. Accepts active, open, pending, closed, or spam; open is normalized to active.'
);
server.registerTool(
  'update_conversation_status',
  {
    title: 'Update Conversation Status',
    description:
      'Change the status of an existing conversation. Accepts active, open, pending, closed, or spam; open is normalized to active.',
    inputSchema: {
      conversationId: conversationRefSchema,
      status: z
        .enum(['active', 'open', 'pending', 'closed', 'spam'])
        .describe('New conversation status. "open" is treated as "active".'),
    },
    outputSchema: conversationStatusOutputSchema,
    annotations: MUTATING_REMOTE_ANNOTATIONS,
  },
  async ({ conversationId: conversationRef, status }) => {
    const conversationId = await client.resolveConversationId(conversationRef);
    const normalizedStatus = normalizeConversationStatus(status);
    await client.updateConversationStatus(conversationId, normalizedStatus);
    return structuredJsonResult({ success: true, conversationId, status: normalizedStatus });
  }
);

rememberTool('add_tag', 'Add a tag to a conversation');
server.registerTool(
  'add_tag',
  {
    title: 'Add Tag',
    description: 'Add a tag to a conversation',
    inputSchema: {
      conversationId: conversationRefSchema,
      tag: z.string().describe('Tag name to add'),
    },
    outputSchema: taggedConversationOutputSchema,
    annotations: MUTATING_REMOTE_ANNOTATIONS,
  },
  async ({ conversationId: conversationRef, tag }) => {
    const conversationId = await client.resolveConversationId(conversationRef);
    await client.addConversationTag(conversationId, tag);
    return structuredJsonResult({ success: true, conversationId, tag });
  }
);

rememberTool(
  'search_by_customer',
  "Find conversations involving a customer by email. Searches primary email and domain (for CC'd/teammate tickets). Results deduplicated and capped by maxResults (default 25). Use date filters to narrow large result sets."
);
server.registerTool(
  'search_by_customer',
  {
    title: 'Search By Customer',
    description:
      "Find conversations involving a customer by email. Searches primary email and domain (for CC'd/teammate tickets). Results deduplicated and capped by maxResults (default 25). Use date filters to narrow large result sets.",
    inputSchema: {
      email: z.string().email().describe('Customer email address'),
      status: z
        .enum(['active', 'pending', 'closed', 'spam', 'all'])
        .optional()
        .describe('Status filter (defaults to "all")'),
      maxResults: z
        .number()
        .optional()
        .default(DEFAULT_MAX_RESULTS)
        .describe('Maximum conversations to return (default 25)'),
      ...dateFilterSchema,
    },
    outputSchema: searchByCustomerOutputSchema,
    annotations: READ_ONLY_REMOTE_ANNOTATIONS,
  },
  async ({
    email,
    status = 'all',
    maxResults,
    createdSince,
    createdBefore,
    modifiedSince,
    modifiedBefore,
  }) => {
    const domain = email.split('@')[1];
    const dateFilters = { createdSince, createdBefore, modifiedSince, modifiedBefore };

    const emailQuery = buildDateQuery(dateFilters, `email:${email}`);
    const emailSearch = client.listAllConversations({ query: emailQuery, status }, maxResults);

    const isGenericDomain = GENERIC_EMAIL_DOMAINS.has(domain);
    const domainSearch = isGenericDomain
      ? Promise.resolve([] as Conversation[])
      : client.listAllConversations(
          {
            query: buildDateQuery(dateFilters, `@${domain}`),
            status,
          },
          maxResults
        );

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

    return structuredJsonResult({
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

rememberTool('check_auth', 'Check if Help Scout authentication is configured');
server.registerTool(
  'check_auth',
  {
    title: 'Check Authentication',
    description: 'Check if Help Scout authentication is configured',
    outputSchema: authStatusOutputSchema,
    annotations: READ_ONLY_LOCAL_ANNOTATIONS,
  },
  async () => structuredJsonResult({ authenticated: await auth.isAuthenticated() })
);

rememberTool(
  'search_tools',
  'Search for available tools by name or description using regex. Returns matching tool names.'
);
server.registerTool(
  'search_tools',
  {
    title: 'Search Tools',
    description:
      'Search for available tools by name or description using regex. Returns matching tool names.',
    inputSchema: {
      query: z
        .string()
        .describe('Regex pattern to match against tool names and descriptions (case-insensitive)'),
    },
    annotations: READ_ONLY_LOCAL_ANNOTATIONS,
  },
  async ({ query }) => {
    try {
      const pattern = new RegExp(query, 'i');
      const matches = toolRegistry.filter(
        (tool) => pattern.test(tool.name) || pattern.test(tool.description)
      );
      return textJsonResult({ tools: matches });
    } catch {
      return textJsonResult({ error: 'Invalid regex pattern' }, true);
    }
  }
);

export async function runMcpServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
