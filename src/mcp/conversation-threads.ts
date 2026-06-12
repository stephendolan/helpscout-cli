import type { Thread } from '../types/index.js';

export interface ConversationThreadsOptions {
  types?: string[];
  maxThreads?: number;
  cleanThreads?: (threads: Thread[]) => unknown[];
}

export function normalizeThreadTypes(types: string[] | undefined): string[] | undefined {
  if (!types?.length) return undefined;

  const normalized = types.map((type) => type.trim().toLowerCase()).filter(Boolean);
  return normalized.length ? normalized : undefined;
}

export function filterThreadsByType(threads: Thread[], types: string[] | undefined): Thread[] {
  const normalizedTypes = normalizeThreadTypes(types);
  if (!normalizedTypes) return threads;

  const allowedTypes = new Set(normalizedTypes);
  return threads.filter((thread) => allowedTypes.has(thread.type.toLowerCase()));
}

export function buildConversationThreadsResult(
  conversationId: number,
  threads: Thread[],
  options: ConversationThreadsOptions = {}
) {
  const filteredTypes = normalizeThreadTypes(options.types);
  const matchingThreads = filterThreadsByType(threads, filteredTypes);
  const limitedThreads = options.maxThreads
    ? matchingThreads.slice(0, options.maxThreads)
    : matchingThreads;
  const cleanThreads = options.cleanThreads ?? ((items: Thread[]) => items);

  return {
    conversationId,
    threads: cleanThreads(limitedThreads),
    total_threads: threads.length,
    matching_threads: matchingThreads.length,
    returned_threads: limitedThreads.length,
    ...(limitedThreads.length < matchingThreads.length && {
      omitted_threads: matchingThreads.length - limitedThreads.length,
    }),
    ...(filteredTypes && { filtered_types: filteredTypes }),
  };
}
