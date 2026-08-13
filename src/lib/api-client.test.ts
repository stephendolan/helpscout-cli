import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HelpScoutClient } from './api-client.js';

function thread(id: number, type = 'customer') {
  return {
    id,
    type,
    body: `<p>Thread ${id}</p>`,
    createdAt: `2026-06-0${id}T00:00:00Z`,
  };
}

function draftThread(id: number, body = `<p>Draft ${id}</p>`) {
  return {
    id,
    type: 'message',
    status: 'active',
    state: 'draft',
    body,
    createdAt: `2026-06-0${id}T00:00:00Z`,
    createdBy: { id: 42, type: 'user', first: 'Ada', last: 'Lovelace' },
  };
}

function paginatedThreads(
  threads: Array<Record<string, unknown>>,
  page: number,
  totalPages: number
) {
  return Response.json({
    _embedded: { threads },
    page: {
      size: threads.length,
      totalElements: 3,
      totalPages,
      number: page,
    },
  });
}

function paginatedConversations(
  conversations: Array<Record<string, unknown>>,
  page: number,
  totalPages: number
) {
  return Response.json({
    _embedded: { conversations },
    page: {
      size: conversations.length,
      totalElements: totalPages,
      totalPages,
      number: page,
    },
  });
}

describe('HelpScoutClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: HelpScoutClient;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    client = new HelpScoutClient({
      getAccessToken: vi.fn().mockResolvedValue('test-token'),
      getAppId: vi.fn().mockResolvedValue('app-id'),
      getAppSecret: vi.fn().mockResolvedValue('app-secret'),
      getRefreshToken: vi.fn().mockResolvedValue(null),
      setAccessToken: vi.fn().mockResolvedValue(true),
      setRefreshToken: vi.fn().mockResolvedValue(true),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.resetAllMocks();
  });

  it('fetches all conversation thread pages', async () => {
    fetchMock
      .mockResolvedValueOnce(paginatedThreads([thread(1)], 1, 2))
      .mockResolvedValueOnce(paginatedThreads([thread(2, 'note'), thread(3, 'lineitem')], 2, 2));

    const threads = await client.getConversationThreads(123);

    expect(threads).toEqual([thread(1), thread(2, 'note'), thread(3, 'lineitem')]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.helpscout.net/v2/conversations/123/threads?page=1'
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      'https://api.helpscout.net/v2/conversations/123/threads?page=2'
    );
  });

  it('stops fetching thread pages after maxResults is reached', async () => {
    fetchMock.mockResolvedValueOnce(paginatedThreads([thread(1), thread(2, 'note')], 1, 2));

    const threads = await client.getConversationThreads(123, 1);

    expect(threads).toEqual([thread(1)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('downloads attachment file bytes with response metadata', async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0xff]);
    fetchMock.mockResolvedValueOnce(
      new Response(bytes, {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Length': String(bytes.length),
          'Content-Disposition': 'attachment; filename="Invoice-BFFE9E51-0026.pdf"',
        },
      })
    );

    const attachment = await client.downloadAttachment(3361978051, 933302294);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.helpscout.net/v2/conversations/3361978051/attachments/933302294/file',
      expect.objectContaining({ method: 'GET' })
    );
    expect(Array.from(attachment.data)).toEqual(Array.from(bytes));
    expect(attachment.contentType).toBe('application/pdf');
    expect(attachment.contentLength).toBe(bytes.length);
    expect(attachment.contentDisposition).toBe('attachment; filename="Invoice-BFFE9E51-0026.pdf"');
  });

  it('refreshes auth and retries attachment downloads after 401 responses', async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    fetchMock
      .mockResolvedValueOnce(Response.json({ error: 'unauthorized' }, { status: 401 }))
      .mockResolvedValueOnce(
        Response.json({
          access_token: 'fresh-token',
          token_type: 'Bearer',
          expires_in: 3600,
        })
      )
      .mockResolvedValueOnce(
        new Response(bytes, { headers: { 'Content-Type': 'application/pdf' } })
      );

    const attachment = await client.downloadAttachment(3361978051, 933302294);

    expect(Array.from(attachment.data)).toEqual(Array.from(bytes));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.helpscout.net/v2/conversations/3361978051/attachments/933302294/file'
    );
    expect(fetchMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
      })
    );
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.helpscout.net/v2/oauth2/token');
    expect(fetchMock.mock.calls[2][0]).toBe(
      'https://api.helpscout.net/v2/conversations/3361978051/attachments/933302294/file'
    );
    expect(fetchMock.mock.calls[2][1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer fresh-token' }),
      })
    );
  });

  it('sends a status patch request', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await client.updateConversationStatus(123, 'closed');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.helpscout.net/v2/conversations/123',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ op: 'replace', path: '/status', value: 'closed' }),
      })
    );
  });

  it('serializes the idiomatic assignee option to the Help Scout wire name', async () => {
    fetchMock.mockResolvedValueOnce(paginatedConversations([], 1, 1));

    await client.listConversations({ assignedTo: '728656' });

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get('assigned_to')).toBe('728656');
    expect(url.searchParams.has('assignedTo')).toBe(false);
  });

  it('preserves status, sort, query, and page while mapping a team assignee ID', async () => {
    fetchMock.mockResolvedValueOnce(paginatedConversations([], 3, 3));

    await client.listConversations({
      status: 'all',
      assignedTo: '987654',
      sortField: 'modifiedAt',
      sortOrder: 'asc',
      query: 'assigned:"Questionnaires"',
      page: 3,
    });

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      status: 'all',
      assigned_to: '987654',
      sortField: 'modifiedAt',
      sortOrder: 'asc',
      query: 'assigned:"Questionnaires"',
      page: '3',
    });
  });

  it('keeps the mapped assignee filter on every conversation page', async () => {
    fetchMock
      .mockResolvedValueOnce(paginatedConversations([{ id: 1 }], 1, 2))
      .mockResolvedValueOnce(paginatedConversations([{ id: 2 }], 2, 2));

    const conversations = await client.listAllConversations({
      status: 'active',
      assignedTo: '728656',
      query: 'assigned:"Questionnaires"',
    });

    expect(conversations).toEqual([{ id: 1 }, { id: 2 }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [index, call] of fetchMock.mock.calls.entries()) {
      const url = new URL(call[0]);
      expect(url.searchParams.get('assigned_to')).toBe('728656');
      expect(url.searchParams.has('assignedTo')).toBe(false);
      expect(url.searchParams.get('page')).toBe(String(index + 1));
      expect(url.searchParams.get('status')).toBe('active');
      expect(url.searchParams.get('query')).toBe('assigned:"Questionnaires"');
    }
  });

  it('creates a draft reply, parses Resource-ID, and verifies the live thread', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ primaryCustomer: { id: 729732479 } }))
      .mockResolvedValueOnce(
        new Response(null, { status: 201, headers: { 'Resource-ID': '10420000001' } })
      )
      .mockResolvedValueOnce(
        paginatedThreads([draftThread(10420000001, '<p>Draft reply</p>')], 1, 1)
      );

    const result = await client.createDraftReply(3401014297, {
      text: '<p>Draft reply</p>',
      user: 903917,
    });

    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.helpscout.net/v2/conversations/3401014297'
    );
    expect(fetchMock.mock.calls[1]).toEqual([
      'https://api.helpscout.net/v2/conversations/3401014297/reply',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          text: '<p>Draft reply</p>',
          user: 903917,
          customer: { id: 729732479 },
          draft: true,
        }),
      }),
    ]);
    expect(result).toEqual(
      expect.objectContaining({
        conversationId: 3401014297,
        threadId: 10420000001,
        action: 'created',
        verified: true,
      })
    );
  });

  it('fails creation when Help Scout omits the Resource-ID header', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ primaryCustomer: { id: 729732479 } }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));

    await expect(client.createDraftReply(123, { text: 'Draft' })).rejects.toThrow(
      'did not return a valid Resource-ID'
    );
  });

  it('lists only active draft reply threads with safe selection metadata', async () => {
    const longBody = 'x'.repeat(350);
    fetchMock.mockResolvedValueOnce(
      paginatedThreads(
        [
          draftThread(11, longBody),
          { ...thread(12, 'message'), state: 'published' },
          thread(13, 'note'),
          { ...draftThread(14), status: 'pending' },
        ],
        1,
        1
      )
    );

    const drafts = await client.listDraftReplies(123);

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toEqual(
      expect.objectContaining({
        conversationId: 123,
        threadId: 11,
        state: 'draft',
        body: longBody,
        preview: `${'x'.repeat(300)}...`,
        createdBy: expect.objectContaining({ id: 42 }),
      })
    );
  });

  it('updates a specific draft with JSON Patch and verifies the result', async () => {
    fetchMock
      .mockResolvedValueOnce(paginatedThreads([draftThread(11, 'Old')], 1, 1))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(paginatedThreads([draftThread(11, 'New')], 1, 1));

    const result = await client.updateDraftReply(123, 11, 'New');

    expect(fetchMock.mock.calls[1]).toEqual([
      'https://api.helpscout.net/v2/conversations/123/threads/11',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ op: 'replace', path: '/text', value: 'New' }),
      }),
    ]);
    expect(result).toEqual(
      expect.objectContaining({ threadId: 11, action: 'updated', verified: true })
    );
  });

  it('verifies plain-text newlines after Help Scout converts them to br tags', async () => {
    fetchMock
      .mockResolvedValueOnce(paginatedThreads([draftThread(11, 'Old')], 1, 1))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        paginatedThreads([draftThread(11, 'First line<br>Second line')], 1, 1)
      );

    await expect(client.updateDraftReply(123, 11, 'First line\nSecond line')).resolves.toEqual(
      expect.objectContaining({ verified: true })
    );
  });

  it('verifies semantically equivalent HTML input', async () => {
    fetchMock
      .mockResolvedValueOnce(paginatedThreads([draftThread(11, 'Old')], 1, 1))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        paginatedThreads([draftThread(11, '<p>Hello <strong>there</strong></p>')], 1, 1)
      );

    await expect(client.updateDraftReply(123, 11, 'Hello <strong>there</strong>')).resolves.toEqual(
      expect.objectContaining({ verified: true })
    );
  });

  it('normalizes whitespace and newlines during verification', async () => {
    fetchMock
      .mockResolvedValueOnce(paginatedThreads([draftThread(11, 'Old')], 1, 1))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        paginatedThreads([draftThread(11, '<p>Hello there</p><p>Next line</p>')], 1, 1)
      );

    await expect(
      client.updateDraftReply(123, 11, '  Hello   there\r\n\nNext line  ')
    ).resolves.toEqual(expect.objectContaining({ verified: true }));
  });

  it('refuses to update a published or non-draft thread', async () => {
    fetchMock.mockResolvedValueOnce(
      paginatedThreads([{ ...thread(11, 'message'), state: 'published' }], 1, 1)
    );

    await expect(client.updateDraftReply(123, 11, 'New')).rejects.toThrow(
      'expected an active draft reply'
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses an unknown thread ID before writing', async () => {
    fetchMock.mockResolvedValueOnce(paginatedThreads([draftThread(11)], 1, 1));

    await expect(client.updateDraftReply(123, 99, 'New')).rejects.toThrow('does not exist');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('creates on upsert when no active draft exists', async () => {
    fetchMock
      .mockResolvedValueOnce(paginatedThreads([], 1, 1))
      .mockResolvedValueOnce(Response.json({ primaryCustomer: { id: 7 } }))
      .mockResolvedValueOnce(new Response(null, { status: 201, headers: { 'Resource-ID': '22' } }))
      .mockResolvedValueOnce(paginatedThreads([draftThread(22, 'Desired')], 1, 1));

    const result = await client.upsertDraftReply(123, { text: 'Desired' });

    expect(result.action).toBe('created');
    expect(result.threadId).toBe(22);
  });

  it('updates the sole active draft on upsert', async () => {
    fetchMock
      .mockResolvedValueOnce(paginatedThreads([draftThread(11, 'Old')], 1, 1))
      .mockResolvedValueOnce(paginatedThreads([draftThread(11, 'Old')], 1, 1))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(paginatedThreads([draftThread(11, 'Desired')], 1, 1));

    const result = await client.upsertDraftReply(123, { text: 'Desired' });

    expect(result.action).toBe('updated');
    expect(result.threadId).toBe(11);
  });

  it('refuses ambiguous upsert when multiple active drafts exist', async () => {
    fetchMock.mockResolvedValueOnce(paginatedThreads([draftThread(11), draftThread(12)], 1, 1));

    await expect(client.upsertDraftReply(123, { text: 'Desired' })).rejects.toThrow(
      'Refusing to choose among 2 active draft replies (11, 12)'
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses an explicit thread ID to disambiguate upsert', async () => {
    fetchMock
      .mockResolvedValueOnce(
        paginatedThreads([draftThread(11, 'First'), draftThread(12, 'Second')], 1, 1)
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        paginatedThreads([draftThread(11, 'First'), draftThread(12, 'Desired')], 1, 1)
      );

    const result = await client.upsertDraftReply(123, { text: 'Desired', threadId: 12 });

    expect(result.threadId).toBe(12);
    expect(result.action).toBe('updated');
  });

  it('reports post-write verification failures without claiming success', async () => {
    fetchMock
      .mockResolvedValueOnce(paginatedThreads([draftThread(11, 'Old')], 1, 1))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(paginatedThreads([draftThread(11, 'Old')], 1, 1));

    await expect(client.updateDraftReply(123, 11, 'Desired')).rejects.toThrow(
      'post-write verification failed'
    );
  });

  it.each([
    ['published state', { state: 'published' }],
    ['inactive status', { status: 'pending' }],
    ['non-message type', { type: 'note' }],
  ])('rejects post-write verification for %s', async (_label, override) => {
    fetchMock
      .mockResolvedValueOnce(paginatedThreads([draftThread(11, 'Old')], 1, 1))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        paginatedThreads([{ ...draftThread(11, 'Desired'), ...override }], 1, 1)
      );

    await expect(client.updateDraftReply(123, 11, 'Desired')).rejects.toThrow(
      'post-write verification failed'
    );
  });

  it('sends private notes with optional status', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 201 }));

    await client.createNote(123, { text: 'No action needed.', status: 'closed' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.helpscout.net/v2/conversations/123/notes',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ text: 'No action needed.', status: 'closed' }),
      })
    );
  });
});
