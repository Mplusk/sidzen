import { slugify, translatedSpecifications } from "./format";

export const CATALOG_FACET_VERSION = 2;
export type CatalogFacetValue = { kind: "material" | "color"; slug: string; name: string };
export function specificationFacets(specifications: unknown): CatalogFacetValue[] {
  const result = new Map<string, CatalogFacetValue>();
  for (const [label, raw] of Object.entries(translatedSpecifications(specifications))) {
    const key = label.toLocaleLowerCase("ru").trim();
    const kind = /^(материал|материал изделия|материал товара|основной материал)$/.test(key) ? "material"
      : /^(цвет|цвет изделия|цвет товара|основной цвет)$/.test(key) ? "color" : null;
    if (!kind) continue;
    for (const value of raw.split(/[,;/]/).map(value => value.trim()).filter(Boolean).slice(0, 12)) {
      let name = value.normalize("NFKC").replace(/\s+/g, " ").slice(0, 80);
      if (kind === "material") name = name.replace(/\s*(?:пластик|пластика)$/iu, "").trim();
      if (kind === "color") name = name.toLocaleLowerCase("ru").replace(/ё/g, "е");
      const slug = slugify(name).slice(0, 80);
      if (slug) result.set(`${kind}:${slug}`, { kind, name, slug });
    }
  }
  return [...result.values()];
}
