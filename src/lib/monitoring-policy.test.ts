import { afterEach, expect, it, vi } from "vitest";
import { monitoringCutoff, monitoringDay, publicMonitoringPath, monitoringOriginAllowed } from "./monitoring-policy";
afterEach(() => vi.unstubAllEnvs());
it("stores a Moscow calendar day, never an event timestamp", () => {
  expect(monitoringDay(new Date("2026-10-17T20:59:59Z"))).toEqual(new Date("2026-10-17Z"));
  expect(monitoringDay(new Date("2026-10-17T21:00:00Z"))).toEqual(new Date("2026-10-18Z"));
  expect(monitoringCutoff(30, new Date("2026-10-18T12:01:02Z"))).toEqual(new Date("2026-09-19Z"));
  expect(monitoringCutoff(1, new Date("2026-10-18T12:01:02Z"))).toEqual(new Date("2026-10-18Z"));
});
it("rejects private routes, searches, URLs and arbitrary query parameters", () => {
  for (const path of ["/account/", "/admin/", "/checkout/", "/cart/", "/api/", "/catalog/?q=Иван", "/catalog/?token=secret", "//evil.test/", "/catalog/../account/", "/catalog/x%2faccount/", "/catalog/phone+79991234567/", "/catalog/x/y/z/", "/catalog/user@example.test/"]) expect(publicMonitoringPath(path)).toBeNull();
  expect(publicMonitoringPath("/catalog/decor/coral")).toBe("/catalog/decor/coral/");
  expect(publicMonitoringPath("/catalog/%D0%B4%D0%B5%D0%BA%D0%BE%D1%80/")).toBe("/catalog/декор/");
  expect(publicMonitoringPath("/about/")).toBe("/about/");
  expect(publicMonitoringPath("/")).toBe("/");
});
it("rejects cross-origin and missing-origin requests without an identity token", () => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://sidzen.shop");
  const request = (origin?: string, site = "same-origin") => new Request("https://sidzen.shop/api/page-views/", { headers: { ...(origin ? { Origin: origin } : {}), "Sec-Fetch-Site": site } });
  expect(monitoringOriginAllowed(request("https://sidzen.shop"))).toBe(true);
  expect(monitoringOriginAllowed(request("https://evil.test"))).toBe(false);
  expect(monitoringOriginAllowed(request("https://sidzen.shop", "cross-site"))).toBe(false);
  expect(monitoringOriginAllowed(request())).toBe(false);
});
