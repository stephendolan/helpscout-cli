import { describe, expect, it, vi } from 'vitest';
import { client } from '../lib/api-client.js';
import { createConversationsCommand } from './conversations.js';

describe('conversations command', () => {
  it('documents assignee filtering for both users and teams', () => {
    const conversations = createConversationsCommand();
    const list = conversations.commands.find((command) => command.name() === 'list');
    const assignedTo = list?.options.find((option) => option.long === '--assigned-to');

    expect(assignedTo?.description).toBe('Filter by assignee user or team ID');
  });

  it('forwards the assignee ID with combined list filters', async () => {
    const listConversations = vi.spyOn(client, 'listConversations').mockResolvedValue({
      conversations: [],
      page: { number: 1, size: 0, totalElements: 0, totalPages: 0 },
    });
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await createConversationsCommand().parseAsync([
        'node',
        'test',
        'list',
        '--status',
        'all',
        '--assigned-to',
        '987654',
        '--sort-field',
        'modifiedAt',
        '--sort-order',
        'asc',
        '--query',
        'assigned:"Questionnaires"',
      ]);

      expect(listConversations).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'all',
          assignedTo: '987654',
          sortField: 'modifiedAt',
          sortOrder: 'asc',
          query: 'assigned:"Questionnaires"',
        })
      );
    } finally {
      output.mockRestore();
      listConversations.mockRestore();
    }
  });

  it('registers the attachment download command and output options', () => {
    const conversations = createConversationsCommand();
    const attachments = conversations.commands.find((command) => command.name() === 'attachments');
    const download = attachments?.commands.find((command) => command.name() === 'download');

    expect(attachments).toBeDefined();
    expect(download).toBeDefined();
    expect(download?.registeredArguments.map((argument) => argument.name())).toEqual([
      'conversationId',
      'attachmentId',
    ]);
    expect(download?.options.map((option) => option.flags)).toEqual([
      '-o, --output <path>',
      '-f, --force',
    ]);
  });

  it('registers one assignment command for user, team, and unassign targets', () => {
    const conversations = createConversationsCommand();
    const assign = conversations.commands.find((command) => command.name() === 'assign');

    expect(assign?.description()).toContain('Assign or reassign');
    expect(assign?.registeredArguments.map((argument) => argument.name())).toEqual([
      'id',
      'assigneeId',
    ]);
    expect(assign?.options.map((option) => option.long)).toContain('--unassign');
  });

  it('assigns a conversation and prints the resolved target', async () => {
    const resolveConversationId = vi.spyOn(client, 'resolveConversationId').mockResolvedValue(123);
    const updateConversationAssignee = vi
      .spyOn(client, 'updateConversationAssignee')
      .mockResolvedValue();
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await createConversationsCommand().parseAsync(['node', 'test', 'assign', '#48172', '456']);

      expect(resolveConversationId).toHaveBeenCalledWith('#48172');
      expect(updateConversationAssignee).toHaveBeenCalledWith(123, 456);
      expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toEqual({
        message: 'Conversation assigned',
        conversationId: 123,
        assigneeId: 456,
      });
    } finally {
      output.mockRestore();
      updateConversationAssignee.mockRestore();
      resolveConversationId.mockRestore();
    }
  });

  it('unassigns a conversation and reports a null assignee', async () => {
    const resolveConversationId = vi.spyOn(client, 'resolveConversationId').mockResolvedValue(123);
    const updateConversationAssignee = vi
      .spyOn(client, 'updateConversationAssignee')
      .mockResolvedValue();
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await createConversationsCommand().parseAsync([
        'node',
        'test',
        'assign',
        '123',
        '--unassign',
      ]);

      expect(updateConversationAssignee).toHaveBeenCalledWith(123, null);
      expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toEqual({
        message: 'Conversation unassigned',
        conversationId: 123,
        assigneeId: null,
      });
    } finally {
      output.mockRestore();
      updateConversationAssignee.mockRestore();
      resolveConversationId.mockRestore();
    }
  });

  it.each([
    { args: [], detail: 'Provide a Help Scout user or team ID, or pass --unassign' },
    {
      args: ['456', '--unassign'],
      detail: 'Provide either an assignee ID or --unassign, not both',
    },
    { args: ['456oops'], detail: 'Invalid assignee ID: "456oops"' },
    { args: ['0'], detail: 'Invalid assignee ID: "0"' },
  ])('rejects an invalid assignment target before making an API request', async ({
    args,
    detail,
  }) => {
    const resolveConversationId = vi.spyOn(client, 'resolveConversationId');
    const updateConversationAssignee = vi.spyOn(client, 'updateConversationAssignee');
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as never);

    try {
      await expect(
        createConversationsCommand().parseAsync(['node', 'test', 'assign', '123', ...args])
      ).rejects.toThrow('process.exit');
      expect(resolveConversationId).not.toHaveBeenCalled();
      expect(updateConversationAssignee).not.toHaveBeenCalled();
      expect(JSON.parse(String(output.mock.calls.at(-1)?.[0]))).toEqual({
        error: { name: 'cli_error', detail, statusCode: 400 },
      });
    } finally {
      exit.mockRestore();
      output.mockRestore();
      updateConversationAssignee.mockRestore();
      resolveConversationId.mockRestore();
    }
  });

  it('registers complete safe draft-reply lifecycle commands', () => {
    const conversations = createConversationsCommand();
    const legacyUpsert = conversations.commands.find((command) => command.name() === 'draft-reply');
    const drafts = conversations.commands.find((command) => command.name() === 'draft-replies');

    expect(legacyUpsert?.options.map((option) => option.flags)).toContain('--thread-id <id>');
    expect(drafts?.commands.map((command) => command.name())).toEqual([
      'list',
      'create',
      'update',
      'upsert',
    ]);
    expect(
      drafts?.commands.find((command) => command.name() === 'update')?.registeredArguments
    ).toHaveLength(2);
  });
});
