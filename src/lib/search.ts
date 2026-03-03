/** Help Scout defaults to OR-matching between terms; AND is the universally expected default. */
export function normalizeSearchQuery(query: string | undefined): string | undefined {
  if (!query || !query.trim()) return query;

  if (/\b(AND|OR|NOT)\b/.test(query)) return query;

  const tokens = tokenize(query);

  if (tokens.length <= 1) return query;

  return tokens.join(' AND ');
}

function tokenize(query: string): string[] {
  const tokens: string[] = [];
  const regex = /\S*"[^"]*"\S*|\S+/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(query)) !== null) {
    tokens.push(match[0]);
  }
  return tokens;
}
