import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ enabled: vi.fn(), consume: vi.fn(), finish: vi.fn() }));
vi.mock("@/lib/admin-login-challenge", () => ({ adminEmailProtectionEnabled: m.enabled, consumeAdminLogin: m.consume }));
vi.mock("@/lib/auth", () => ({ finishSession: m.finish }));
import { GET, POST } from "./route";

it("serves an isolated no-store confirmation document with a matching script CSP", async () => {
  const response = GET(), html = await response.text();
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  expect(script).toBeTruthy();
  const hash = createHash("sha256").update(script!).digest("base64");
  expect(response.headers.get("content-security-policy")).toContain(`script-src 'sha256-${hash}'`);
  expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  expect(response.headers.get("cache-control")).toContain("no-store");
  expect(response.headers.get("referrer-policy")).toBe("same-origin");
  expect(html).not.toMatch(/<script[^>]+src=|<iframe|metrika/i);
  expect(m.consume).not.toHaveBeenCalled();
});
it("rejects cross-origin confirmation before consuming any token", async () => {
  const response = await POST(new Request("https://sidzen.shop/admin-login-confirm/", { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/x-www-form-urlencoded", "Content-Length": "10" }, body: "token=abc" }));
  expect(response.status).toBe(400); expect(m.consume).not.toHaveBeenCalled();
});
it("rejects an opaque Origin before consuming a token", async () => {
  const response = await POST(new Request("https://sidzen.shop/admin-login-confirm/", { method: "POST", headers: { Origin: "null", "Content-Type": "application/x-www-form-urlencoded", "Content-Length": "10" }, body: "token=abc" }));
  expect(response.status).toBe(400); expect(m.consume).not.toHaveBeenCalled();
});

