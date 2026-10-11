import { afterEach, describe, expect, it } from "vitest";
import { hasTrustedOrigin } from "./request-security";

describe("hasTrustedOrigin", () => {
  const nodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    Object.assign(process.env, { NODE_ENV: nodeEnv });
  });

  it("accepts a matching production HTTPS origin", () => {
    Object.assign(process.env, { NODE_ENV: "production" });
    const request = new Request("http://app/api/model/upload", {
      headers: { origin: "https://sidzen.shop", host: "app:3000", "x-forwarded-host": "sidzen.shop" },
    });
    expect(hasTrustedOrigin(request)).toBe(true);
  });

  it("rejects cross-site and insecure production origins", () => {
    Object.assign(process.env, { NODE_ENV: "production" });
    const foreign = new Request("https://sidzen.shop/api/model/upload", { headers: { origin: "https://evil.example", host: "sidzen.shop" } });
    const insecure = new Request("http://sidzen.shop/api/model/upload", { headers: { origin: "http://sidzen.shop", host: "sidzen.shop" } });
    expect(hasTrustedOrigin(foreign)).toBe(false);
    expect(hasTrustedOrigin(insecure)).toBe(false);
  });

  it("accepts same-host SIDZEN requests without trusting cross-domain posts", () => {
    Object.assign(process.env, { NODE_ENV: "production" });
    expect(hasTrustedOrigin(new Request("http://app/api/delivery/ozon/points", { headers: { origin: "https://sidzen.shop", "x-forwarded-host": "sidzen.shop", host: "app:3000" } }))).toBe(true);
    expect(hasTrustedOrigin(new Request("http://app/api/delivery/ozon/points", { headers: { origin: "https://unrelated.example", "x-forwarded-host": "sidzen.shop", host: "app:3000" } }))).toBe(false);
  });
});
