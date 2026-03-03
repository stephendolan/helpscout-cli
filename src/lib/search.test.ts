import { describe, it, expect } from 'vitest';
import { normalizeSearchQuery } from './search.js';

describe('normalizeSearchQuery', () => {
  it('should AND-join multiple bare terms', () => {
    expect(normalizeSearchQuery('audio latency')).toBe('audio AND latency');
  });

  it('should AND-join many bare terms', () => {
    expect(normalizeSearchQuery('screen share not working')).toBe(
      'screen AND share AND not AND working'
    );
  });

  it('should pass through queries with explicit AND operator', () => {
    expect(normalizeSearchQuery('audio AND latency')).toBe('audio AND latency');
  });

  it('should pass through queries with explicit OR operator', () => {
    expect(normalizeSearchQuery('audio OR latency')).toBe('audio OR latency');
  });

  it('should pass through queries with explicit NOT operator', () => {
    expect(normalizeSearchQuery('NOT billing')).toBe('NOT billing');
  });

  it('should pass through mixed explicit operators', () => {
    expect(normalizeSearchQuery('audio AND latency OR video')).toBe(
      'audio AND latency OR video'
    );
  });

  it('should not transform a single token', () => {
    expect(normalizeSearchQuery('billing')).toBe('billing');
  });

  it('should not transform a single search prefix token', () => {
    expect(normalizeSearchQuery('email:user@test.com')).toBe('email:user@test.com');
  });

  it('should AND-join search prefix with bare term', () => {
    expect(normalizeSearchQuery('email:user@test.com connection')).toBe(
      'email:user@test.com AND connection'
    );
  });

  it('should AND-join tag prefix with bare term', () => {
    expect(normalizeSearchQuery('tag:Bug audio')).toBe('tag:Bug AND audio');
  });

  it('should preserve quoted phrases as single tokens', () => {
    expect(normalizeSearchQuery('"screen share" issue')).toBe('"screen share" AND issue');
  });

  it('should preserve prefixed quoted phrases as single tokens', () => {
    expect(normalizeSearchQuery('subject:"billing issue" audio')).toBe(
      'subject:"billing issue" AND audio'
    );
  });

  it('should return empty string unchanged', () => {
    expect(normalizeSearchQuery('')).toBe('');
  });

  it('should return whitespace-only string unchanged', () => {
    expect(normalizeSearchQuery('   ')).toBe('   ');
  });

  it('should return undefined unchanged', () => {
    expect(normalizeSearchQuery(undefined)).toBeUndefined();
  });
});
