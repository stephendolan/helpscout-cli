import type { ConversationStatus } from '../types/index.js';
import { HelpScoutCliError } from './errors.js';

export const conversationStatuses: ConversationStatus[] = ['active', 'pending', 'closed', 'spam'];
export const conversationStatusInputs = [...conversationStatuses, 'open'] as const;

export type ConversationStatusInput = (typeof conversationStatusInputs)[number];

export function normalizeConversationStatus(status: string): ConversationStatus {
  const normalized = status.trim().toLowerCase();

  if (normalized === 'open') {
    return 'active';
  }

  if (conversationStatuses.includes(normalized as ConversationStatus)) {
    return normalized as ConversationStatus;
  }

  throw new HelpScoutCliError(
    `Invalid conversation status: "${status}". Use one of: ${conversationStatusInputs.join(', ')}`,
    400
  );
}
