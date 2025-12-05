import { handleHelpScoutError, HelpScoutCliError } from './errors.js';
import { outputJson } from './output.js';

export function withErrorHandling<T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
): (...args: T) => Promise<void> {
  return async (...args: T) => {
    try {
      await fn(...args);
    } catch (error) {
      handleHelpScoutError(error);
    }
  };
}

export function parseIdArg(value: string, resourceType: string = 'resource'): number {
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed <= 0) {
    throw new HelpScoutCliError(`Invalid ${resourceType} ID: "${value}"`, 400);
  }
  return parsed;
}

export function requireAtLeastOneField(
  data: Record<string, unknown>,
  operation: string,
): void {
  const hasFields = Object.values(data).some((v) => v !== undefined);
  if (!hasFields) {
    throw new HelpScoutCliError(`${operation} requires at least one field to update`, 400);
  }
}

export async function confirmDelete(
  resourceType: string,
  skipConfirmation?: boolean,
): Promise<boolean> {
  if (skipConfirmation) {
    return true;
  }

  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  return new Promise((resolve) => {
    rl.question(`Delete ${resourceType}? (y/N) `, (answer) => {
      rl.close();
      if (answer.toLowerCase() !== 'y') {
        outputJson({ cancelled: true, message: 'Deletion cancelled' });
        process.exit(0);
      }
      resolve(true);
    });
  });
}
