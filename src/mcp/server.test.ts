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
});
