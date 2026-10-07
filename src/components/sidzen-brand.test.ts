import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
it("uses the supplied brand palette, Inter and a dense responsive catalog", () => {
  for (const color of ["#f8f5ef", "#d9c8b2", "#6b6f5b", "#2e2e29", "#9c8b79"]) expect(css).toContain(color);
  expect(css).toContain('font-family: "Inter Variable"');
  expect(css).toContain(".catalog-results .product-card h3");
  expect(css).not.toContain("#d90068");
  expect(css).not.toContain("#285de8");
});
it("serves both domains without a cross-brand redirect and redirects www to its own host", () => {
  const caddy = readFileSync(new URL("../../deploy/caddy/Caddyfile", import.meta.url), "utf8");
  expect(caddy).toContain("3dprinta.shop, sidzen.shop {");
  expect(caddy).toContain("redir https://sidzen.shop{uri} permanent");
});
it("uses exact extracted outlined logo glyphs, with no external fonts in the logo", () => {
  const svg = readFileSync(new URL("../../public/brand/sidzen-logo.svg", import.meta.url), "utf8");
  expect(svg).toContain('viewBox="112 229 310 100"');
  expect(svg).toContain('stroke="#2e2e29"');
  expect(svg).toContain('fill="#9c8b79"');
  expect(svg).not.toContain("<text");
  expect(svg).not.toContain("http://fonts");
});
