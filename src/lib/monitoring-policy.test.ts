import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { monitoringConsent, readMonitoringConsent, monitoringId, monitoringSource, monitoringAgent, trustedVisitorIp, publicMonitoringPath, safeSearch, monitoringOriginAllowed } from "./monitoring-policy";
import { monitoringCountry } from "./monitoring-country";
beforeEach(() => { vi.stubEnv("AUTH_SECRET", "synthetic-monitoring-secret"); vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://sidzen.shop"); });
afterEach(() => vi.unstubAllEnvs());
it("requires a valid signed, versioned, unexpired consent and separate visitor identity", () => {
  const at = 1791710000000, token = monitoringConsent(at);
  expect(readMonitoringConsent(token, at + 1000)?.at.getTime()).toBe(at);
  expect(readMonitoringConsent(token + "x", at + 1000)).toBeNull();
  expect(readMonitoringConsent(token, at - 1)).toBeNull();
  expect(readMonitoringConsent(token, at + 30 * 86400000)).toBeNull();
  expect(monitoringId("visitor-a", "same-page")).not.toBe(monitoringId("visitor-b", "same-page"));
  vi.stubEnv("AUTH_SECRET", ""); expect(readMonitoringConsent(token, at + 1000)).toBeNull();
});
it("ignores spoofed proxy chains and only accepts Caddy's overwritten header", () => {
  expect(trustedVisitorIp(new Headers({ "x-forwarded-for": "8.8.8.8" }))).toBeNull();
  expect(trustedVisitorIp(new Headers({ "x-sidzen-client-ip": "::ffff:8.8.8.8", "x-forwarded-for": "1.1.1.1" }))).toBe("8.8.8.8");
  expect(trustedVisitorIp(new Headers({ "x-sidzen-client-ip": "8.8.8.8,1.1.1.1" }))).toBeNull();
});
it("never records private routes, arbitrary URLs, credentials, email or phone searches", () => {
  for (const path of ["/account/", "/admin/", "/checkout/", "/api/", "/catalog/?token=secret", "//evil.test/", "/catalog/../account/", "/catalog/x%2faccount/"]) expect(publicMonitoringPath(path)).toBeNull();
  expect(publicMonitoringPath("/catalog/decor/coral/")).toBe("/catalog/decor/coral/");
  expect(safeSearch("Настольные лампы")).toBe("Настольные лампы");
  for (const text of ["buyer@example.test", "+79991234567", "https://evil.test/", "password secret"]) expect(safeSearch(text)).toBeNull();
});
it("retains only referrer domain and genuine optional search phrase", () => {
  expect(monitoringSource("https://www.google.com/search?q=лампа&token=secret", "spring")).toEqual({ source: "www.google.com", searchPhrase: "лампа", campaign: "spring" });
  expect(monitoringSource("https://news.example.test/story?email=secret", "phone79991234567")).toEqual({ source: "news.example.test", searchPhrase: null, campaign: null });
  expect(monitoringSource("https://sidzen.shop/catalog/", undefined).source).toBeNull();
  expect(monitoringSource("javascript:alert(1)", undefined).source).toBeNull();
});
it("rejects cross-origin and missing-origin requests", () => {
  const request = (origin?: string) => new Request("https://sidzen.shop/api/monitoring/", { headers: origin ? { Origin: origin } : {} });
  expect(monitoringOriginAllowed(request("https://sidzen.shop"))).toBe(true);
  expect(monitoringOriginAllowed(request("https://evil.test"))).toBe(false);
  expect(monitoringOriginAllowed(request())).toBe(false);
});
it("uses offline country data, including IPv6, without network requests", () => {
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Network forbidden"));
  expect(monitoringCountry("8.8.8.8")).toBe("US");
  expect(monitoringCountry("92.63.101.127")).toBe("RU");
  expect(monitoringCountry("2001:4860:4860::8888")).toBe("US");
  for (const ip of ["127.0.0.1", "10.0.0.1", "192.168.1.1", "::1", "fc00::1", "invalid", null]) expect(monitoringCountry(ip)).toBeNull();
  expect(network).not.toHaveBeenCalled(); network.mockRestore();
  expect(monitoringAgent("Mozilla/5.0 iPhone Mobile Safari/604").device).toBe("Телефон");
  expect(monitoringAgent("Googlebot").bot).toBe(true);
});
