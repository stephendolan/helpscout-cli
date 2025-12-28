import dayjs from 'dayjs';
import { HelpScoutCliError } from './errors.js';

export function parseDateTime(input: string): string {
  const d = dayjs(input);
  if (!d.isValid()) {
    throw new HelpScoutCliError(`Invalid date: ${input}`, 400);
  }
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

interface DateFilters {
  createdSince?: string;
  createdBefore?: string;
  modifiedSince?: string;
  modifiedBefore?: string;
}

export function buildDateQuery(filters: DateFilters, existingQuery?: string): string | undefined {
  const parts: string[] = [];

  if (filters.createdSince) {
    const date = parseDateTime(filters.createdSince);
    parts.push(`createdAt:[${date} TO *]`);
  }

  if (filters.createdBefore) {
    const date = parseDateTime(filters.createdBefore);
    parts.push(`createdAt:[* TO ${date}]`);
  }

  if (filters.modifiedSince) {
    const date = parseDateTime(filters.modifiedSince);
    parts.push(`modifiedAt:[${date} TO *]`);
  }

  if (filters.modifiedBefore) {
    const date = parseDateTime(filters.modifiedBefore);
    parts.push(`modifiedAt:[* TO ${date}]`);
  }

  if (parts.length === 0) {
    return existingQuery;
  }

  const dateQuery = parts.join(' AND ');

  if (existingQuery) {
    return `(${existingQuery}) AND ${dateQuery}`;
  }

  return dateQuery;
}
