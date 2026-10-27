import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
import { CatalogFilters } from "./catalog-filters";

it("hides all empty attribute groups but keeps real options and the price filter", () => {
  const html = renderToStaticMarkup(createElement(CatalogFilters, { base: "/catalog/", params: {}, count: 8, groups: [
    { key: "color", label: "Цвет", options: [] },
    { key: "material", label: "Материал", options: [{ name: "PLA", slug: "pla", count: 8 }] },
  ] }));
  expect(html).not.toContain("Технология"); expect(html).not.toContain("<legend>Цвет</legend>");
  expect(html).toContain("<legend>Материал</legend>"); expect(html).toContain("PLA");
  expect(html).toContain("<legend>Цена, ₽</legend>"); expect(html).toContain('step="any"');
});

it("does not hide an existing selected option with zero matches", () => {
  const html = renderToStaticMarkup(createElement(CatalogFilters, { base: "/catalog/", params: { material: "pla" }, count: 0, groups: [
    { key: "material", label: "Материал", options: [{ name: "PLA", slug: "pla", count: 0 }] },
  ] }));
  expect(html).toContain("Материал"); expect(html).toContain('checked=""'); expect(html).toContain("PLA");
});
