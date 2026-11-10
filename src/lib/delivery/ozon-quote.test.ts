import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { buildOzonPostings, cartDeliveryFingerprint, signOzonQuote, verifyOzonQuote } from "./ozon-quote";
import { deliveryConfigFingerprint } from "./ozon-config";

const config = { enabled: true, clientId: "app", clientSecret: "secret", shipmentMethodId: 7, dispatchDays: 1, checkedAt: "2030-01-01T00:00:00Z" };
const item = { id: "line", quantity: 2, unitPrice: 240, config: { color: "black" }, product: { name: "Test", madeToOrder: true, leadDays: 3, shippingWeightG: 85, shippingLengthMm: 200, shippingWidthMm: 100, shippingHeightMm: 80 } };
const cart = { id: "cart", items: [item] };
beforeEach(() => { vi.stubEnv("AUTH_SECRET", "test-only-quote-key"); });
describe("server-owned Ozon shipping quotes", () => {
  it("uses measured packaged dimensions, one parcel per unit and manufacturing delay", () => {
    const postings = buildOzonPostings(cart.items, config, Date.parse("2030-01-01T00:00:00Z"));
    expect(postings).toHaveLength(2);
    expect(postings[0]).toMatchObject({ request_id: 1, cutoff_at: "2030-01-04T00:00:00.000Z", declared_value: { amount: "240.00" }, dimensions: { weight_g: 85, length_mm: 200 } });
    expect(postings[1].request_id).toBe(2);
  });
  it("rejects missing packaging and >100 units instead of inventing numbers", () => {
    expect(() => buildOzonPostings([{ ...item, product: { ...item.product, shippingWeightG: null } }], config)).toThrow("packaging");
    expect(() => buildOzonPostings([{ ...item, quantity: 101 }], config)).toThrow("parcels");
    expect(() => buildOzonPostings([{ ...item, quantity: 0 }], config)).toThrow();
  });
  it("binds the signed amount, buyer phone, cart, packaging, configuration and expiry", () => {
    const quote = { request: { recipient: { phone_number: "+79991234567" }, delivery: { delivery_point: { delivery_point_id: 42 } }, postings: buildOzonPostings(cart.items, config) }, cart: cartDeliveryFingerprint(cart), config: deliveryConfigFingerprint(config), address: "Test PVZ", cost: 180, days: 3, expires: Date.now() + 60000, quoteVersion: 2 as const };
    const token = signOzonQuote(quote);
    expect(verifyOzonQuote(token, cart, config, "+79991234567").cost).toBe(180);
    for (const other of [{ ...cart, id: "another-cart" }, { ...cart, items: [{ ...item, quantity: 3 }] }, { ...cart, items: [{ ...item, unitPrice: 241 }] }, { ...cart, items: [{ ...item, product: { ...item.product, shippingWeightG: 90 } }] }]) expect(() => verifyOzonQuote(token, other, config, "+79991234567")).toThrow("quote");
    expect(() => verifyOzonQuote(token, cart, config, "+79990000000")).toThrow("quote");
    expect(() => verifyOzonQuote(token, cart, { ...config, shipmentMethodId: 8 }, "+79991234567")).toThrow("quote");
    expect(() => verifyOzonQuote(signOzonQuote({ ...quote, expires: 1 }), cart, config, "+79991234567")).toThrow("quote");
    const forged = `${Buffer.from(JSON.stringify({ ...quote, cost: 0 })).toString("base64url")}.${token.split(".")[1]}`;
    expect(() => verifyOzonQuote(forged, cart, config, "+79991234567")).toThrow("quote");
    const legacy = { ...quote, quoteVersion: undefined, consentId: "previous-consent" };
    expect(verifyOzonQuote(signOzonQuote(legacy), cart, config, "+79991234567").consentId).toBe("previous-consent");
    expect(() => verifyOzonQuote(signOzonQuote({ ...legacy, consentId: undefined }), cart, config, "+79991234567")).toThrow("quote");
    const forgedVersion = `${Buffer.from(JSON.stringify({ ...legacy, quoteVersion: 2, consentId: undefined })).toString("base64url")}.${signOzonQuote(legacy).split(".")[1]}`;
    expect(() => verifyOzonQuote(forgedVersion, cart, config, "+79991234567")).toThrow("quote");
  });
});
