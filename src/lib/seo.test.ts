import { describe, expect, it } from "vitest";
import { allowsIndexing, catalogIndexing, isOwnCanonical, normalizePageTitle, primaryVisibleCategorySlug, searchDescription } from "./seo";

describe("normalizePageTitle", () => {
  it("removes a stored brand suffix before the global title template", () => {
    expect(normalizePageTitle("Органайзер Axis | 3DPRINTA")).toBe("Органайзер Axis");
    expect(normalizePageTitle("Органайзеры — 3DPRINTA")).toBe("Органайзеры");
    expect(normalizePageTitle("Органайзеры | SIDZEN")).toBe("Органайзеры");
  });

  it("keeps ordinary titles intact", () => {
    expect(normalizePageTitle("3D-печать по модели")).toBe("3D-печать по модели");
  });
});

describe("search metadata", () => {
  it("uses existing descriptive copy when short descriptions are absent", () => {
    expect(searchDescription(null, "", "  Подставка для салфеток.\n Для кухни. ")).toBe("Подставка для салфеток. Для кухни.");
    expect(searchDescription(null, " ")).toBeUndefined();
    expect(searchDescription("товар ".repeat(60))!.length).toBeLessThanOrEqual(160);
  });
  it("uses a visible primary category and a deterministic fallback", () => {
    const row = (slug: string, visible: boolean, isPrimary: boolean) => ({ category: { slug, visible }, isPrimary });
    expect(primaryVisibleCategorySlug([row("hidden", false, true), row("b", true, false), row("a", true, false)])).toBe("a");
    expect(primaryVisibleCategorySlug([row("b", true, true), row("a", true, false)])).toBe("b");
    expect(primaryVisibleCategorySlug([row("hidden", false, true)])).toBeUndefined();
  });
  it("keeps filtered pages out of search and pagination self-canonical", () => {
    expect(catalogIndexing("/catalog/decor/", { page: "2" })).toEqual({ canonical: "/catalog/decor/?page=2", filtered: false });
    expect(catalogIndexing("/", { page: "1" })).toEqual({ canonical: "/", filtered: false });
    expect(catalogIndexing("/", { page: "2", color: "red" }).filtered).toBe(true);
    expect(catalogIndexing("/", { page: "-1" }).filtered).toBe(true);
  });
  it("respects noindex and explicit canonicals in the sitemap", () => {
    expect(allowsIndexing("NOINDEX, follow")).toBe(false);
    expect(allowsIndexing("index,follow")).toBe(true);
    expect(allowsIndexing("none")).toBe(false);
    expect(isOwnCanonical("/catalog/decor/item/", "/catalog/decor/item/", "https://sidzen.shop")).toBe(true);
    expect(isOwnCanonical("/other/", "/catalog/decor/item/", "https://sidzen.shop")).toBe(false);
  });
});
