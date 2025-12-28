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

function rangeClause(field: string, since?: string, before?: string): string[] {
  const clauses: string[] = [];
  if (since) clauses.push(`${field}:[${parseDateTime(since)} TO *]`);
  if (before) clauses.push(`${field}:[* TO ${parseDateTime(before)}]`);
  return clauses;
}

export function buildDateQuery(filters: DateFilters, existingQuery?: string): string | undefined {
  const parts = [
    ...rangeClause('createdAt', filters.createdSince, filters.createdBefore),
    ...rangeClause('modifiedAt', filters.modifiedSince, filters.modifiedBefore),
  ];

  if (parts.length === 0) return existingQuery;

  const dateQuery = parts.join(' AND ');
  return existingQuery ? `(${existingQuery}) AND ${dateQuery}` : dateQuery;
}
