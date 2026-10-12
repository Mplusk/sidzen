import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import config from "../../next.config";

it("keeps optimized images on a bounded persistent app-only volume", () => {
  const compose = readFileSync("compose.yaml", "utf8");
  const app = compose.split("\n  app:\n")[1].split("\n  marketplace-worker:\n")[0];
  expect(app).toContain("image-cache:/app/.next/cache/images");
  expect(compose.split("\n  marketplace-worker:\n")[1]).not.toContain("image-cache:/app/");
  expect(compose).toContain("\n  image-cache:");
  const docker = readFileSync("Dockerfile", "utf8");
  expect(docker).toContain("chown nextjs:nodejs /app/private-uploads /app/public/uploads/products /app/.next/cache/images");
  expect(config.images?.maximumDiskCacheSize).toBe(512_000_000);
  expect(config.images?.minimumCacheTTL).toBe(2_678_400);
});
it("long-caches only uniquely named public product files and retains private no-store policy", async () => {
  const headers = await config.headers!();
  const images = headers.find(rule => rule.source.startsWith("/uploads/products/"));
  expect(images?.source).toContain("mp-[0-9a-f]{64}");
  expect(images?.headers).toContainEqual({ key: "Cache-Control", value: "public, max-age=31536000, immutable" });
  expect(headers.find(rule => rule.source.includes("account|admin"))?.headers).toContainEqual({ key: "Cache-Control", value: "private, no-store, max-age=0" });
  const redirects = await config.redirects!();
  expect(redirects.every(rule => typeof rule.destination === "string")).toBe(true);
});
it("prioritizes only the first two catalog cards rather than the full list", () => {
  expect(readFileSync("src/components/catalog-view.tsx", "utf8")).toContain("highPriority={index < 2}");
});
