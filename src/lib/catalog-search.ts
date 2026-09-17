const synonyms = [["органайзер", "хранен"], ["подстав", "стойк", "держател"], ["креплен", "кронштейн", "фиксатор"], ["декор", "украшен", "ваз"], ["телефон", "смартфон"], ["кабел", "провод"]];
export function searchTerms(query: string) {
  return query.toLocaleLowerCase("ru").replace(/ё/g, "е").slice(0, 120).split(/\s+/).filter(Boolean).slice(0, 6).map((word) => {
    const stem = word.length > 4 ? word.replace(/(ами|ями|ого|ому|ах|ях|ов|ев|ей|ия|ие|ий|ый|ой|ая|ые|ам|ям|а|я|ы|и|у|ю|е|о)$/, "") : word;
    return [...new Set([stem, ...synonyms.filter((group) => group.some((term) => stem.startsWith(term) || term.startsWith(stem))).flat()])];
  });
}
export function filterValues(value?: string) { return [...new Set((value ?? "").split(",").filter((item) => /^[a-z0-9-]{1,80}$/.test(item)))].slice(0, 20); }
export function priceBound(value?: string) { const number = Number(value); return value && Number.isFinite(number) && number >= 0 ? Math.min(number, 999999999) : undefined; }
