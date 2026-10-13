import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Breadcrumbs } from "./breadcrumbs";

const items = [{ label: "Каталог", href: "/catalog/" }, { label: "Декор", href: "/catalog/decor/" }, { label: "Чаша", href: "/catalog/decor/cup/" }];
it("preserves default visible breadcrumb navigation on other pages", () => {
  const html = renderToStaticMarkup(createElement(Breadcrumbs, { items }));
  expect(html).toContain('aria-label="Хлебные крошки"');
  expect(html).toMatch(/href="\/catalog\/decor\/?"/);
});
it("renders no visual navigation or wrapper when breadcrumbs are disabled", () => {
  const html = renderToStaticMarkup(createElement(Breadcrumbs, { items, visible: false }));
  expect(html).not.toContain("<nav");
  expect(html).not.toContain("<a");
  expect(html).not.toContain("<div");
  const schema = JSON.parse(html.match(/<script[^>]*>([\s\S]*?)<\/script>/)![1]);
  expect(schema["@type"]).toBe("BreadcrumbList");
  expect(schema.itemListElement.map((item: { position: number; name: string; item: string }) => [item.position, item.name, item.item])).toEqual([
    [1, "Каталог", "https://sidzen.shop/catalog/"],
    [2, "Декор", "https://sidzen.shop/catalog/decor/"],
    [3, "Чаша", "https://sidzen.shop/catalog/decor/cup/"],
  ]);
});
