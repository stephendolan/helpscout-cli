import { describe, expect, it } from 'vitest';
import type { Thread } from '../types/index.js';
import { buildConversationThreadsResult, filterThreadsByType } from './conversation-threads.js';

function thread(id: number, type: string): Thread {
  return {
    id,
    type,
    body: `<p>${type} ${id}</p>`,
    createdAt: `2026-06-0${id}T00:00:00Z`,
  };
}

describe('conversation thread MCP helpers', () => {
  it('filters thread history by requested type', () => {
    const threads = [thread(1, 'customer'), thread(2, 'note'), thread(3, 'lineitem')];

    expect(filterThreadsByType(threads, [' NOTE ', 'lineitem'])).toEqual([
      thread(2, 'note'),
      thread(3, 'lineitem'),
    ]);
  });

  it('builds uncapped all-type thread results by default', () => {
    const threads = [thread(1, 'customer'), thread(2, 'note'), thread(3, 'lineitem')];

    expect(buildConversationThreadsResult(123, threads)).toEqual({
      conversationId: 123,
      threads,
      total_threads: 3,
      matching_threads: 3,
      returned_threads: 3,
    });
  });

  it('reports filtering and cap metadata', () => {
    const threads = [thread(1, 'customer'), thread(2, 'note'), thread(3, 'note')];

    expect(
      buildConversationThreadsResult(123, threads, {
        types: ['note'],
        maxThreads: 1,
      })
    ).toEqual({
      conversationId: 123,
      threads: [thread(2, 'note')],
      total_threads: 3,
      matching_threads: 2,
      returned_threads: 1,
      omitted_threads: 1,
      filtered_types: ['note'],
    });
  });
});
