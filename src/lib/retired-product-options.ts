// These former manufacturing settings are no longer product choices. Keep
// historical order JSON untouched, but never expose them as current attributes.
export function isRetiredProductSpecification(key: string) {
  const normalized = key.normalize("NFKC").toLocaleLowerCase("ru").replace(/[\s_()·.,/-]+/g, "").trim();
  return /^(?:technolog(?:y|ies)|технологи[яи](?:производства|печати)?|quality(?:profile|profileid|name)?|printquality|качествопечати|профилькачества|postprocess(?:es|ing|option)?|постобработка|layer(?:height(?:mm)?)?|высотаслоя(?:мм)?|слой(?:мм)?)$/.test(normalized);
}

export function currentProductSpecifications(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !isRetiredProductSpecification(key)));
}
