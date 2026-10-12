import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
it("keeps smaller mobile circles with 44px targets and native swipe", () => {
  const css = read("../app/globals.css");
  expect(css).toContain(".gallery-arrow::before"); expect(css).toContain("width: 1.75rem; height: 1.75rem;");
  expect(css).toContain(".gallery-arrow, .product-gallery--compact .gallery-arrow { width: 2.75rem; height: 2.75rem; }");
  expect(css).toContain("scroll-snap-type: x mandatory");
});
it("removes category breadcrumbs but preserves category controls", () => {
  const catalog = read("./catalog-view.tsx"); expect(catalog).not.toContain("Breadcrumbs"); expect(catalog).toContain("<CatalogFilters");
});
it("reveals the familiar wrapping category buttons only in the open Catalog menu", () => {
  const css = read("../app/globals.css"), menu = read("./catalog-menu.tsx");
  expect(menu).toContain('type="button" className="header-catalog"');
  expect(menu).toContain('aria-expanded={open}');
  expect(menu).toContain('hidden={!open}');
  expect(css).toContain('.header-catalog-panel { position: static;');
  expect(css).toContain('.header-catalog-panel:not([hidden]) { display: flex; flex-wrap: wrap; gap: 8px; }');
  expect(css).toContain('.header-catalog-panel a { display: inline-flex;');
  expect(css).toContain('.header-catalog-panel a[aria-current="page"] { background: var(--blue); color: var(--white); }');
});
it("keeps exactly four information links and no Shop footer block", () => {
  const footer = read("./footer.tsx"); expect(footer).not.toContain("<h3>Магазин</h3>");
  for (const href of ["/about/", "/contacts/", "/faq/", "/delivery/"]) expect(footer).toContain(`href="${href}"`);
  for (const href of ["/cart/", "/materials/", "/account/", "/catalog/"]) expect(footer).not.toContain(`href="${href}"`);
});
it("places footer information at the right edge on desktop and the left edge on mobile", () => {
  expect(read("./footer.tsx")).toContain('className="footer-info"');
  const css = read("../app/globals.css");
  expect(css).toContain(".footer-info { justify-self: end; }");
  expect(css.slice(css.lastIndexOf("@media (max-width: 600px)"))).toContain(".footer-info { justify-self: start; }");
});
