import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TOP_MAIL_COOKIE, TOP_MAIL_ENDPOINT, TOP_MAIL_ID } from "@/lib/top-mail";
import { GET } from "./route";

const enabled = vi.hoisted(() => vi.fn());
vi.mock("@/lib/settings", () => ({ isTopMailEnabled: enabled }));

function request(page: string, headers: Record<string, string> = {}) {
  const url = new URL(TOP_MAIL_ENDPOINT, "https://sidzen.shop");
  url.searchParams.set("page", page);
  return new NextRequest(url, { headers: { cookie: `${TOP_MAIL_COOKIE}=1`, "sec-fetch-dest": "iframe", ...headers } });
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://sidzen.shop");
  enabled.mockReset().mockResolvedValue(true);
});
afterEach(() => vi.unstubAllEnvs());

it("checks the current setting on each public view and gates both versions of the counter", async () => {
  const allowed = await GET(request("/catalog/lamp/"));
  const html = await allowed.text();
  expect(html).toContain(`id: ${TOP_MAIL_ID}, type: "pageView"`);
  expect(html).toContain('url: "https://sidzen.shop/catalog/lamp/"');
  expect(html).toContain("https://top-fwz1.mail.ru/js/code.js");
  expect(html).toContain(`counter?id=${TOP_MAIL_ID};js=na`);
  enabled.mockResolvedValue(false);
  const disabled = await GET(request("/catalog/lamp/"));
  expect(disabled.status).toBe(204);
  expect(await disabled.text()).toBe("");
  expect(disabled.headers.get("Cache-Control")).toContain("no-store");
  expect(enabled).toHaveBeenCalledTimes(2);
});

it("keeps the script and the noscript pixel behind explicit consent and route restrictions", async () => {
  for (const req of [
    request("/", { cookie: "" }), request("/", { dnt: "1" }), request("/", { "sec-gpc": "1" }),
    request("/", { "sec-fetch-site": "cross-site" }), request("/account/"), request("/admin/"),
    request("/checkout/"), request("/catalog/?token=private"), request("/catalog/#private"),
  ]) {
    const res = await GET(req);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  }
  expect(enabled).not.toHaveBeenCalled();
});
