import { afterEach, describe, expect, it, vi } from "vitest";
import { callbackUrl, safeSocialReturn, socialReady, type SocialConfig } from "./config";
const config: SocialConfig = { enabled: true, operatorReviewed: true, clientId: "a".repeat(32), clientSecret: "fixture", revision: "revision" };
afterEach(() => vi.unstubAllEnvs());
describe("social provider activation and redirect safety", () => {
  it("requires credentials, identified provider and explicit operator review", () => {
    expect(socialReady("yandex", config)).toBe(true);
    for (const change of [{ enabled: false }, { operatorReviewed: false }, { clientId: "" }, { clientSecret: "" }, { revision: "" }, { clientId: "https://attacker.test" }]) expect(socialReady("yandex", { ...config, ...change })).toBe(false);
    expect(socialReady("vk", { ...config, clientId: "123456", clientSecret: "" })).toBe(true);
  });
  it("does not enable Google from credentials / admin checkbox alone", () => {
    const google = { ...config, clientId: "123456-fixture.apps.googleusercontent.com" };
    vi.stubEnv("GOOGLE_OAUTH_LEGAL_APPROVED", "false"); expect(socialReady("google", google)).toBe(false);
    vi.stubEnv("GOOGLE_OAUTH_LEGAL_APPROVED", "true"); expect(socialReady("google", google)).toBe(true);
  });
  it("rejects external, protocol-relative, backslash, control and oversized return paths", () => {
    for (const unsafe of ["https://attacker.test", "//attacker.test", "/\\attacker.test", "\\/attacker.test", "/\r\nLocation:evil", "/" + "x".repeat(1001), null]) expect(safeSocialReturn(unsafe)).toBe("/account/");
    expect(safeSocialReturn("/checkout/?a=1#shipping")).toBe("/checkout/?a=1#shipping");
  });
  it("uses configured origin only and fixed callback path with trailing slash", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://3dprinta.shop/path"); expect(callbackUrl("vk")).toBe("https://3dprinta.shop/api/auth/social/vk/callback/");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://attacker.test"); expect(() => callbackUrl("vk")).toThrow();
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://secret@attacker.test"); expect(() => callbackUrl("vk")).toThrow();
  });
});
