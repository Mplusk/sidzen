import { describe, expect, it } from "vitest";
import { normalizedHost, usesSidzenDomain, socialLoginHandoff } from "./storefront-domains";
import { publicReviewsForHost, publicReviewWhere, REVIEW_CONSENT_VERSION, REVIEW_CONSENT_TEXT } from "./reviews";

describe("additional SIDZEN domain", () => {
  it("recognizes only the exact new storefront hosts", () => {
    expect(normalizedHost("SIDZEN.SHOP:443")).toBe("sidzen.shop");
    expect(usesSidzenDomain("sidzen.shop.evil.test")).toBe(false);
    expect(usesSidzenDomain("www.sidzen.shop")).toBe(true);
  });
  it("starts OAuth on its registered domain without forwarding a password or binding cookie", () => {
    expect(socialLoginHandoff("sidzen.shop", "https://3dprinta.shop", "/account/")).toBe("https://3dprinta.shop/login/?returnTo=%2Faccount%2F");
    expect(socialLoginHandoff("sidzen.shop", "https://3dprinta.shop", "/cart/", true)).toBe("https://3dprinta.shop/account/profile/");
    expect(socialLoginHandoff("3dprinta.shop", "https://3dprinta.shop", "/account/")).toBeNull();
    expect(socialLoginHandoff("sidzen.shop", "https://sidzen.shop", "/account/")).toBeNull();
  });
  it("does not republish old single-domain consents on the alias", () => {
    expect(publicReviewsForHost("3dprinta.shop")).toEqual(publicReviewWhere);
    expect(publicReviewsForHost("sidzen.shop")).toEqual({ approved: true, consent: { is: { revokedAt: null, purpose: "review", version: REVIEW_CONSENT_VERSION } } });
    expect(REVIEW_CONSENT_TEXT).toContain("sidzen.shop и 3dprinta.shop");
    expect(REVIEW_CONSENT_VERSION).not.toBe("2026-10-06-reviews-v1");
  });
});
