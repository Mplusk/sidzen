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
      headers: { origin: "https://3dprinta.shop", host: "app:3000", "x-forwarded-host": "3dprinta.shop" },
    });
    expect(hasTrustedOrigin(request)).toBe(true);
  });

  it("rejects cross-site and insecure production origins", () => {
    Object.assign(process.env, { NODE_ENV: "production" });
    const foreign = new Request("https://3dprinta.shop/api/model/upload", { headers: { origin: "https://evil.example", host: "3dprinta.shop" } });
    const insecure = new Request("http://3dprinta.shop/api/model/upload", { headers: { origin: "http://3dprinta.shop", host: "3dprinta.shop" } });
    expect(hasTrustedOrigin(foreign)).toBe(false);
    expect(hasTrustedOrigin(insecure)).toBe(false);
  });

  it("accepts same-host SIDZEN requests without trusting cross-domain posts", () => {
    Object.assign(process.env, { NODE_ENV: "production" });
    expect(hasTrustedOrigin(new Request("http://app/api/delivery/ozon/points", { headers: { origin: "https://sidzen.shop", "x-forwarded-host": "sidzen.shop", host: "app:3000" } }))).toBe(true);
    expect(hasTrustedOrigin(new Request("http://app/api/delivery/ozon/points", { headers: { origin: "https://3dprinta.shop", "x-forwarded-host": "sidzen.shop", host: "app:3000" } }))).toBe(false);
  });
});
