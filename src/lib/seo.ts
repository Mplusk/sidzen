export function normalizePageTitle(value: string) {
  return value.replace(/\s*(?:\||—|-)\s*(?:3DPRINTA|SIDZEN)\s*$/i, "").trim();
}

/** Collapse the actual product copy for search snippets, without fabricating content. */
export function searchDescription(...values: Array<string | null | undefined>) {
  const text = values.find(value => value?.trim())?.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  if (text.length <= 160) return text;
  const prefix = text.slice(0, 157);
  const boundary = prefix.lastIndexOf(" ");
  return (boundary > 80 ? prefix.slice(0, boundary) : prefix) + "…";
}

export function primaryVisibleCategorySlug(categories: Array<{ isPrimary: boolean; category: { slug: string; visible: boolean } }>) {
  return categories.filter(item => item.category.visible).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.category.slug.localeCompare(b.category.slug))[0]?.category.slug;
}

export function allowsIndexing(robots: string | null | undefined) {
  return !/(?:^|[,\s])(?:noindex|none)(?:$|[,\s])/i.test(robots ?? "");
}

export function isOwnCanonical(canonical: string | null, path: string, base: string) {
  if (!canonical?.trim()) return true;
  try { return new URL(canonical, base).href === new URL(path, base).href; } catch { return false; }
}

export function catalogIndexing(base: string, params: Record<string, unknown>) {
  const entries = Object.entries(params).filter(([, value]) => value !== undefined && value !== "");
  const onlyPage = entries.every(([key]) => key === "page");
  const rawPage = params.page;
  const validPage = rawPage === undefined || rawPage === "" || (typeof rawPage === "string" && /^[1-9]\d{0,3}$/.test(rawPage));
  const page = validPage && typeof rawPage === "string" ? Number(rawPage) : 1;
  return { canonical: onlyPage && validPage && page > 1 ? `${base}?page=${page}` : base, filtered: !onlyPage || !validPage };
}
