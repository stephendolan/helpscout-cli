import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let mcpServer: typeof import('./server.js');

beforeAll(async () => {
  Object.assign(globalThis, {
    __VERSION__: 'test',
    __HOMEPAGE__: '',
  });
  mcpServer = await import('./server.js');
});

afterAll(() => {
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
        'update_conversation_status',
        'create_note',
      ])
    );
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
});
