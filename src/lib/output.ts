import { convert } from 'html-to-text';
import type { OutputOptions } from '../types/index.js';

let globalOutputOptions: OutputOptions = {};

export function setOutputOptions(options: OutputOptions): void {
  globalOutputOptions = options;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function htmlToPlainText(html: string): string {
  const text = convert(html, {
    wordwrap: false,
    preserveNewlines: false,
    selectors: [
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'img', format: 'skip' },
    ],
  });

  return text
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function convertBodiesToPlainText(data: unknown): unknown {
  if (Array.isArray(data)) {
    return data.map(convertBodiesToPlainText);
  }

  if (isObject(data)) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (key === 'body' && typeof value === 'string') {
        result[key] = htmlToPlainText(value);
      } else {
        result[key] = convertBodiesToPlainText(value);
      }
    }
    return result;
  }

  return data;
}

function stripMetadata(data: unknown): unknown {
  if (Array.isArray(data)) {
    return data.map(stripMetadata);
  }

  if (isObject(data)) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (key === '_links' || key === '_embedded') {
        continue;
      }
      result[key] = stripMetadata(value);
    }
    return result;
  }

  return data;
}

function stripTagStyles(data: unknown): unknown {
  if (Array.isArray(data)) {
    return data.map(stripTagStyles);
  }

  if (isObject(data)) {
    const result: Record<string, unknown> = {};
    const isTag = 'id' in data && 'name' in data && 'slug' in data;

    for (const [key, value] of Object.entries(data)) {
      if (isTag && (key === 'color' || key === 'styles')) {
        continue;
      }
      result[key] = stripTagStyles(value);
    }
    return result;
  }

  return data;
}

function selectFields(data: unknown, fields: string[]): unknown {
  if (Array.isArray(data)) {
    return data.map((item) => selectFields(item, fields));
  }

  if (isObject(data)) {
    const hasRequestedFields = fields.some((f) => f in data);
    if (hasRequestedFields) {
      const result: Record<string, unknown> = {};
      for (const field of fields) {
        if (field in data) {
          result[field] = data[field];
        }
      }
      return result;
    }

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      result[key] = selectFields(value, fields);
    }
    return result;
  }

  return data;
}

export function outputJson(data: unknown, options: OutputOptions = {}): void {
  const mergedOptions = { ...globalOutputOptions, ...options };

  let processed = data;

  if (mergedOptions.slim) {
    processed = stripMetadata(processed);
  }

  if (mergedOptions.plain) {
    processed = convertBodiesToPlainText(processed);
  }

  processed = stripTagStyles(processed);

  if (mergedOptions.fields) {
    const fieldList = mergedOptions.fields.split(',').map((f) => f.trim());
    processed = selectFields(processed, fieldList);
  }

  const jsonString = mergedOptions.compact
    ? JSON.stringify(processed)
    : JSON.stringify(processed, null, 2);

  console.log(jsonString);
}
