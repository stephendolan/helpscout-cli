import { handleHelpScoutError, HelpScoutCliError } from './errors.js';

export function withErrorHandling<T extends unknown[], R>(
  fn: (...args: T) => Promise<R>
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

export function requireAtLeastOneField(data: Record<string, unknown>, operation: string): void {
  const hasFields = Object.values(data).some((v) => v !== undefined);
  if (!hasFields) {
    throw new HelpScoutCliError(`${operation} requires at least one field to update`, 400);
  }
}

export function requireConfirmation(itemType: string, confirmed: boolean = false): void {
  if (!confirmed) {
    throw new HelpScoutCliError(
      `Deleting ${itemType} requires --yes flag to confirm`,
      400
    );
  }
}
