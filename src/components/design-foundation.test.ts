import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
it("keeps independent motion, transparency and contrast fallbacks", () => {
  for (const signal of ["prefers-reduced-motion: reduce", "prefers-reduced-transparency: reduce", "prefers-contrast: more"]) expect(css).toContain(`@media (${signal})`);
  expect(css).toContain("backdrop-filter: none");
  expect(css).toContain(".button:active:not(:disabled)");
  expect(css).not.toContain(".button:hover { transform: translateY");
});
it("uses a native momentum gallery, system typography and enlarged touch targets", () => {
  expect(css).toContain("-apple-system, BlinkMacSystemFont");
  expect(css).toContain("scroll-snap-type: x mandatory");
  expect(css).not.toMatch(/font-size:\s*\d+(?:\.\d+)?px/);
  expect(css).toContain("@media (pointer: coarse)");
  expect(css).toContain(".gallery-dots button { flex-basis: 2.75rem");
  expect(css).toContain(".button--outline:hover:not(:disabled) { color: var(--blue-dark); background: #edf2ff;");
});
