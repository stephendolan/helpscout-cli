import dayjs from 'dayjs';
import { HelpScoutCliError } from './errors.js';

export function parseDateTime(input: string): string {
  const d = dayjs(input);
  if (!d.isValid()) {
    throw new HelpScoutCliError(`Invalid date: ${input}`, 400);
  }
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
