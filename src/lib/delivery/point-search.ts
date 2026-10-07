/** Public directory search: words may be partial, in any order, separated by punctuation. */
export function pointSearchTerms(query: string): string[] {
  const normalized = query.normalize("NFKC").toLocaleLowerCase("ru").replaceAll("ё", "е");
  const terms = [...new Set(normalized.match(/[\p{L}\p{N}]+/gu) || [])];
  return terms.length <= 12 && terms.some(term => term.length >= 2) ? terms : [];
}
