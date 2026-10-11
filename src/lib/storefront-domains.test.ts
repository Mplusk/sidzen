import { describe, expect, it } from "vitest";
import { normalizedHost, usesSidzenDomain, socialLoginHandoff, STOREFRONT_HOSTS } from "./storefront-domains";
import { publicReviewsForHost, publicReviewWhere, REVIEW_CONSENT_VERSION, REVIEW_CONSENT_TEXT, SIDZEN_REVIEW_CONSENT_VERSIONS } from "./reviews";

describe("single SIDZEN storefront", () => {
  it("recognizes only the exact new storefront hosts", () => {
    expect(normalizedHost("SIDZEN.SHOP:443")).toBe("sidzen.shop");
    expect(STOREFRONT_HOSTS).toEqual(["sidzen.shop"]);
    expect(usesSidzenDomain("sidzen.shop.evil.test")).toBe(false);
    expect(usesSidzenDomain("www.sidzen.shop")).toBe(true);
  });
  it("normalizes www for OAuth and never redirects to an unrelated login", () => {
    expect(socialLoginHandoff("www.sidzen.shop", "https://sidzen.shop", "/account/")).toBe("https://sidzen.shop/login/?returnTo=%2Faccount%2F");
    expect(socialLoginHandoff("www.sidzen.shop", "https://sidzen.shop", "/cart/", true)).toBe("https://sidzen.shop/account/profile/");
    expect(socialLoginHandoff("sidzen.shop", "https://unrelated.example", "/account/")).toBeNull();
    expect(socialLoginHandoff("sidzen.shop", "https://sidzen.shop", "/account/")).toBeNull();
  });
  it("retains unchanged v2 SIDZEN consent, excludes old single-site consent", () => {
    expect(publicReviewsForHost("sidzen.shop")).toEqual(publicReviewWhere);
    expect(publicReviewsForHost("localhost:3101")).toEqual(publicReviewWhere);
    expect(publicReviewWhere).toEqual({ approved: true, consent: { is: { revokedAt: null, purpose: "review", version: { in: SIDZEN_REVIEW_CONSENT_VERSIONS } } } });
    expect(SIDZEN_REVIEW_CONSENT_VERSIONS).toContain("2026-10-07-reviews-sidzen-v2");
    expect(SIDZEN_REVIEW_CONSENT_VERSIONS).not.toContain("2026-10-06-reviews-v1");
    expect(REVIEW_CONSENT_TEXT).toContain("на сайте sidzen.shop");
    expect(REVIEW_CONSENT_TEXT).not.toContain("двух сайтах");
    expect(REVIEW_CONSENT_VERSION).not.toBe("2026-10-06-reviews-v1");
  });
});
