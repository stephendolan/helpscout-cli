import { describe, expect, it } from 'vitest';
import { HelpScoutCliError } from './errors.js';
import { normalizeConversationStatus } from './conversation-status.js';

describe('normalizeConversationStatus', () => {
  it.each(['active', 'pending', 'closed', 'spam'])('accepts %s', (status) => {
    expect(normalizeConversationStatus(status)).toBe(status);
  });

  it('maps open to active', () => {
    expect(normalizeConversationStatus('open')).toBe('active');
  });

  it('normalizes case and whitespace', () => {
    expect(normalizeConversationStatus(' Pending ')).toBe('pending');
  });

  it('rejects unsupported values', () => {
    expect(() => normalizeConversationStatus('resolved')).toThrowError(HelpScoutCliError);
  });
});
