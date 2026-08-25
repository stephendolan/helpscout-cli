import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { client as helpScoutClient } from '../lib/api-client.js';

let mcpServer: typeof import('./server.js');
let testClient: Client;

beforeAll(async () => {
  Object.assign(globalThis, {
    __VERSION__: 'test',
    __HOMEPAGE__: '',
  });
  mcpServer = await import('./server.js');
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  testClient = new Client({ name: 'helpscout-test', version: '1.0.0' });
  await Promise.all([
    testClient.connect(clientTransport),
    mcpServer.getMcpServerForTesting().connect(serverTransport),
  ]);
});

afterAll(async () => {
  await testClient.close();
  delete (globalThis as { __VERSION__?: string }).__VERSION__;
  delete (globalThis as { __HOMEPAGE__?: string }).__HOMEPAGE__;
});

describe('Help Scout MCP server helpers', () => {
  it('registers the conversation tools needed for GTD triage', () => {
    const toolNames = mcpServer.getRegisteredToolsForTesting().map((tool) => tool.name);

    expect(toolNames).toEqual(
      expect.arrayContaining([
        'get_conversation',
        'get_conversation_threads',
        'list_draft_replies',
        'create_draft_reply',
        'update_draft_reply',
        'upsert_draft_reply',
        'download_attachment',
        'update_conversation_status',
        'assign_conversation',
        'create_note',
      ])
    );
  });

  it('registers a discoverable assignment tool with nullable user or team IDs', async () => {
    const tools = await testClient.listTools();
    const assignment = tools.tools.find((tool) => tool.name === 'assign_conversation');

    expect(assignment?.description?.toLowerCase()).toContain('assign');
    expect(assignment?.description?.toLowerCase()).toContain('reassign');
    expect(assignment?.description?.toLowerCase()).toContain('assignee');
    expect(assignment?.inputSchema).toMatchObject({
      required: ['conversationId', 'assigneeId'],
      properties: {
        conversationId: expect.any(Object),
        assigneeId: expect.any(Object),
      },
    });
  });

  it.each([
    'assign',
    'reassign',
    'assignee',
  ])('finds conversation assignment through the %s tool search term', async (query) => {
    const result = await testClient.callTool({
      name: 'search_tools',
      arguments: { query },
    });
    if (!Array.isArray(result.content) || result.content[0]?.type !== 'text') {
      throw new Error('search_tools did not return text content');
    }
    const payload = JSON.parse(String(result.content[0].text));

    expect(payload.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'assign_conversation' })])
    );
  });

  it('assigns through the MCP tool and returns structured success output', async () => {
    const resolveConversationId = vi
      .spyOn(helpScoutClient, 'resolveConversationId')
      .mockResolvedValue(123);
    const updateConversationAssignee = vi
      .spyOn(helpScoutClient, 'updateConversationAssignee')
      .mockResolvedValue();

    try {
      const result = await testClient.callTool({
        name: 'assign_conversation',
        arguments: { conversationId: '#48172', assigneeId: 456 },
      });

      expect(resolveConversationId).toHaveBeenCalledWith('#48172');
      expect(updateConversationAssignee).toHaveBeenCalledWith(123, 456);
      expect(result.structuredContent).toEqual({
        success: true,
        conversationId: 123,
        assigneeId: 456,
      });
    } finally {
      updateConversationAssignee.mockRestore();
      resolveConversationId.mockRestore();
    }
  });

  it('rejects an invalid MCP assignee before making an API request', async () => {
    const resolveConversationId = vi.spyOn(helpScoutClient, 'resolveConversationId');
    const updateConversationAssignee = vi.spyOn(helpScoutClient, 'updateConversationAssignee');

    try {
      const result = await testClient.callTool({
        name: 'assign_conversation',
        arguments: { conversationId: 123, assigneeId: -1 },
      });

      expect(result.isError).toBe(true);
      expect(resolveConversationId).not.toHaveBeenCalled();
      expect(updateConversationAssignee).not.toHaveBeenCalled();
    } finally {
      updateConversationAssignee.mockRestore();
      resolveConversationId.mockRestore();
    }
  });

  // Help Scout system-action threads (assigned/moved/merged) carry
  // action.associatedEntities. The action sub-object must stay passthrough so
  // its closed JSON output schema doesn't reject real payloads downstream.
  it('preserves unknown action fields on threads instead of rejecting them', () => {
    const thread = {
      id: 1,
      type: 'lineitem',
      createdAt: '2026-01-01T00:00:00Z',
      action: {
        type: 'movedFromMailbox',
        text: 'Moved from Sales',
        associatedEntities: { mailboxIds: [42] },
      },
    };

    const parsed = mcpServer.getThreadSchemaForTesting().parse(thread);

    expect(parsed.action?.associatedEntities).toEqual({ mailboxIds: [42] });
  });

  it('accepts only verified unsent message drafts in lifecycle outputs', () => {
    const { draftReplyWriteOutputSchema } = mcpServer.getDraftReplySchemasForTesting();
    const result = {
      success: true as const,
      conversationId: 123,
      threadId: 456,
      action: 'updated' as const,
      verified: true as const,
      draft: {
        conversationId: 123,
        threadId: 456,
        type: 'message' as const,
        state: 'draft' as const,
        status: 'active' as const,
        body: 'Desired text',
        preview: 'Desired text',
        createdAt: '2026-08-12T00:00:00Z',
      },
    };

    expect(draftReplyWriteOutputSchema.parse(result)).toEqual(result);
    expect(() =>
      draftReplyWriteOutputSchema.parse({
        ...result,
        draft: { ...result.draft, state: 'published' },
      })
    ).toThrow();
    expect(() =>
      draftReplyWriteOutputSchema.parse({
        ...result,
        draft: { ...result.draft, status: 'pending' },
      })
    ).toThrow();
  });
});
