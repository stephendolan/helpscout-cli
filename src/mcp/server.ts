import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { client } from '../lib/api-client.js';
import { auth } from '../lib/auth.js';

const server = new McpServer({
  name: 'helpscout',
  version: '1.0.0',
});

function jsonResponse(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

server.tool(
  'list_conversations',
  'List conversations with optional filtering by status, mailbox, tag, or assignee',
  {
    status: z
      .enum(['active', 'pending', 'closed', 'spam', 'all'])
      .optional()
      .describe('Conversation status filter'),
    mailbox: z.string().optional().describe('Mailbox ID to filter by'),
    tag: z.string().optional().describe('Tag to filter by'),
    assignedTo: z.string().optional().describe('User ID assigned to'),
    query: z.string().optional().describe('Search query'),
    page: z.number().optional().describe('Page number'),
  },
  async ({ status, mailbox, tag, assignedTo, query, page }) =>
    jsonResponse(await client.listConversations({ status, mailbox, tag, assignedTo, query, page }))
);

server.tool(
  'get_conversation',
  'Get detailed information about a specific conversation including threads',
  {
    conversationId: z.number().describe('Conversation ID'),
    includeThreads: z.boolean().optional().describe('Include conversation threads'),
  },
  async ({ conversationId, includeThreads }) => {
    const conversation = await client.getConversation(conversationId);
    if (includeThreads) {
      const threads = await client.getConversationThreads(conversationId);
      return jsonResponse({ ...conversation, threads });
    }
    return jsonResponse(conversation);
  }
);

server.tool(
  'search_conversations',
  'Search all conversations matching a query',
  {
    query: z.string().describe('Search query (e.g., "email:domain.com", "subject:billing")'),
    status: z
      .enum(['active', 'pending', 'closed', 'spam', 'all'])
      .optional()
      .describe('Status filter'),
  },
  async ({ query, status }) => jsonResponse(await client.listAllConversations({ query, status }))
);

server.tool(
  'list_mailboxes',
  'List all mailboxes in the Help Scout account',
  {},
  async () => jsonResponse(await client.listMailboxes())
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
  'check_auth',
  'Check if Help Scout authentication is configured',
  {},
  async () => jsonResponse({ authenticated: await auth.isAuthenticated() })
);

export async function runMcpServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
