import { stat } from "node:fs/promises";
import { NextRequest } from "next/server";
import { afterEach, expect, it, vi } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config, proxy } from "./proxy";

vi.mock("node:fs/promises", () => ({ stat: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const name = "12345678-1234-1234-1234-123456789abc.webp";
it("never matches private routes, optimization requests or unrelated static assets", () => {
  for (const url of ["/account/", "/api/review-images/1/", "/_next/image/", "/generated/photo.webp"]) {
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url })).toBe(false);
  }
  expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: `/uploads/products/${name}` })).toBe(true);
});
it("lets existing immutable uploads use normal public-file serving", async () => {
  vi.mocked(stat).mockResolvedValue({ isFile: () => true } as Awaited<ReturnType<typeof stat>>);
  const response = await proxy(new NextRequest(`https://sidzen.shop/uploads/products/${name}`));
  expect(response.headers.get("x-middleware-next")).toBe("1");
  expect(stat).toHaveBeenCalledWith(expect.stringContaining(`/public/uploads/products/${name}`));
});
it("does not cache missing or inaccessible originals", async () => {
  for (const [code, status] of [["ENOENT", 404], ["EACCES", 500]] as const) {
    vi.mocked(stat).mockRejectedValueOnce(Object.assign(new Error("QA"), { code }));
    const response = await proxy(new NextRequest(`https://sidzen.shop/uploads/products/${name}`));
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  }
});
it("does not access the filesystem for other paths or encoded traversal", async () => {
  for (const path of ["/generated/photo.webp", "/uploads/products/not-immutable.webp", "/uploads/products/%2e%2e%2fsecret.webp"]) {
    await proxy(new NextRequest(`https://sidzen.shop${path}`));
  }
  expect(stat).not.toHaveBeenCalled();
});
