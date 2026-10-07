/** Public directory search: words may be partial, in any order, separated by punctuation. */
export function pointSearchTerms(query: string): string[] {
  const normalized = query.normalize("NFKC").toLocaleLowerCase("ru").replaceAll("ё", "е");
  const terms = [...new Set(normalized.match(/[\p{L}\p{N}]+/gu) || [])];
  return terms.length <= 12 && terms.some(term => term.length >= 2) ? terms : [];
}

// Terms contain only letters/digits, so they cannot inject regular-expression syntax.
// Explicit Cyrillic boundaries also work in a PostgreSQL database with a C locale.
export function pointSearchPattern(term: string, exact = false): string {
  return `(^|[^[:alnum:]а-я])${term}${/^\d+$/.test(term) ? "([^0-9]|$)" : exact ? "([^[:alnum:]а-я]|$)" : ""}`;
}
