import type { HelpScoutError } from '../types/index.js';
import { outputJson } from './output.js';

export class HelpScoutCliError extends Error {
  constructor(
    message: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'HelpScoutCliError';
  }
}

export class HelpScoutApiError extends Error {
  constructor(
    message: string,
    public apiError: unknown,
    public statusCode: number
  ) {
    super(message);
    this.name = 'HelpScoutApiError';
  }
}

const ERROR_STATUS_CODES: Record<string, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  too_many_requests: 429,
  internal_server_error: 500,
  service_unavailable: 503,
};

export function sanitizeErrorMessage(message: string): string {
  const sensitivePatterns = [
    /Bearer\s+[\w\-._~+/]+=*/gi,
    /token[=:]\s*[\w\-._~+/]+=*/gi,
    /client[_-]?secret[=:]\s*[\w\-._~+/]+=*/gi,
    /authorization:\s*bearer\s+[\w\-._~+/]+=*/gi,
  ];

  let sanitized = message;
  for (const pattern of sensitivePatterns) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }

  return sanitized.length > 500 ? sanitized.substring(0, 500) + '...' : sanitized;
}

interface ApiErrorResponse {
  error?: string;
  error_description?: string;
  message?: string;
  _embedded?: {
    errors?: Array<{
      path?: string;
      message?: string;
      rejectedValue?: string;
    }>;
  };
}

function isErrorObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function sanitizeApiError(error: unknown): HelpScoutError {
  if (!isErrorObject(error)) {
    return {
      name: 'api_error',
      detail: 'An error occurred',
    };
  }

  const apiError = error as ApiErrorResponse;

  let detail = 'An error occurred';
  if (apiError.error_description) {
    detail = apiError.error_description;
  } else if (apiError.message) {
    detail = apiError.message;
  } else if (apiError._embedded?.errors?.length) {
    detail = apiError._embedded.errors
      .map((e) => e.message || e.path)
      .filter(Boolean)
      .join('; ');
  }

  return {
    name: apiError.error || 'api_error',
    detail: sanitizeErrorMessage(detail),
  };
}

function formatErrorResponse(name: string, detail: string, statusCode: number): never {
  const hint =
    name === 'too_many_requests'
      ? 'Help Scout API limit: 200 requests/minute. Wait a moment and retry.'
      : undefined;

  const response: { error: { name: string; detail: string; statusCode: number }; hint?: string } = {
    error: { name, detail, statusCode },
  };

  if (hint) {
    response.hint = hint;
  }

  outputJson(response);
  process.exit(1);
}

export function handleHelpScoutError(error: unknown): never {
  if (error instanceof HelpScoutCliError) {
    const sanitized = sanitizeErrorMessage(error.message);
    formatErrorResponse('cli_error', sanitized, error.statusCode || 1);
  }

  if (error instanceof HelpScoutApiError) {
    const hsError: HelpScoutError = sanitizeApiError(error.apiError);
    formatErrorResponse(
      hsError.name,
      hsError.detail,
      error.statusCode || ERROR_STATUS_CODES[hsError.name] || 500
    );
  }

  if (error instanceof Error) {
    const sanitized = sanitizeErrorMessage(error.message);
    formatErrorResponse('unknown_error', sanitized, 1);
  }

  formatErrorResponse('unknown_error', 'An unexpected error occurred', 1);
}
