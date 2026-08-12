import { describe, expect, it } from 'vitest';
import { createConversationsCommand } from './conversations.js';

describe('conversations command', () => {
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
