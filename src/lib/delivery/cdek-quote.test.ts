import { describe, expect, it, vi } from "vitest";
import { cartDeliveryFingerprint } from "./ozon-quote";
import { cdekConfigFingerprint, cdekPackages, signCdekQuote, verifyCdekQuote } from "./cdek-quote";

const config = { enabled: true, clientId: "test", clientSecret: "secret", environment: "test" as const, senderCityCode: 44, senderPoint: "MOS4", senderName: "Seller", senderPhone: "+79990000000" };
const item = { id: "item", quantity: 2, unitPrice: 240, config: {}, product: { name: "Item", madeToOrder: false, leadDays: 0, shippingWeightG: 100, shippingLengthMm: 201, shippingWidthMm: 105, shippingHeightMm: 51 } };
const cart = { id: "cart", items: [item] };

describe("CDEK delivery quote", () => {
  it("uses each real package and rounds dimensions up to whole centimetres", () => {
    expect(cdekPackages(cart)).toEqual([{ weight: 100, length: 21, width: 11, height: 6 }, { weight: 100, length: 21, width: 11, height: 6 }]);
    expect(() => cdekPackages({ ...cart, items: [{ ...item, product: { ...item.product, shippingWeightG: null } }] })).toThrow("packaging");
  });
  it("rejects changed cart, configuration, expiry and modified price", () => {
    vi.stubEnv("AUTH_SECRET", "test-only-signing-key");
    const quote = { point: "MOS4", address: "Test", cityCode: 44, tariff: 136, cost: 200, daysMin: 2, daysMax: 4, cart: cartDeliveryFingerprint(cart), config: cdekConfigFingerprint(config), expires: Date.now() + 60000 };
    const token = signCdekQuote(quote);
    expect(verifyCdekQuote(token, cart, config).cost).toBe(200);
    expect(() => verifyCdekQuote(token, { ...cart, items: [{ ...item, quantity: 3 }] }, config)).toThrow("quote");
    expect(() => verifyCdekQuote(token, cart, { ...config, senderPoint: "other" })).toThrow("quote");
    expect(() => verifyCdekQuote(signCdekQuote({ ...quote, expires: Date.now() - 1 }), cart, config)).toThrow("quote");
    const parts = token.split(".");
    const body = Buffer.from(JSON.stringify({ ...quote, cost: 0 })).toString("base64url");
    expect(() => verifyCdekQuote(`${body}.${parts[1]}`, cart, config)).toThrow("quote");
    vi.unstubAllEnvs();
  });
});
