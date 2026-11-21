import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activeFivePostGeneration, fivePostSchema, fivePostScope } from "./fivepost-config";
import { catalogPoint, fivePostQuote, verifyFivePostQuote } from "./fivepost-quote";
import { fivePostOrderBody } from "./fivepost-worker";
import { FivePostClient } from "./fivepost-client";

const config = fivePostSchema.parse({ enabled: true, environment: "production", apiKey: "synthetic", warehouseId: randomUUID(), senderLocation: "warehouse", checkedAt: new Date().toISOString(), baseKg: 1, rateType: "Hub", slCode: 11 });
const row = {
  id: randomUUID(), name: "Пункт", type: "POSTAMAT", extStatus: "ACTIVE", fullAddress: "Москва, улица Тверская, 8",
  address: { city: "Москва г", region: "Москва", lat: 55.75, lng: 37.61 },
  cellLimits: { maxCellLength: 500, maxCellWidth: 400, maxCellHeight: 300, maxWeight: 15_000_000 },
  rate: [{ rateType: "Hub", rateCurrency: "RUB", zone: "1", rateValueWithVat: 150, rateExtraValueWithVat: 35 }],
  deliverySL: [{ slCode: 10, sl: 20 }, { slCode: 11, sl: 4 }],
};
const cart = { id: "cart", items: [{ id: "item", quantity: 2, unitPrice: 200, config: {}, product: { name: "Товар", madeToOrder: false, leadDays: 0, shippingWeightG: 750, shippingLengthMm: 200, shippingWidthMm: 150, shippingHeightMm: 40 } }] };
const point = catalogPoint(row, config, "generation")!;
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("5Post partner v7.37", () => {
  it("exposes only current, completely published production directories with a verified contract", () => {
    const dir = { active: "A", scope: fivePostScope(config), refreshedAt: new Date() };
    expect(activeFivePostGeneration(config, dir)).toBe("A");
    for (const change of [{ enabled: false }, { environment: "test" as const }, { apiKey: "changed" }, { checkedAt: null }, { baseKg: null }]) expect(activeFivePostGeneration({ ...config, ...change }, dir)).toBeNull();
    expect(activeFivePostGeneration(config, { ...dir, refreshedAt: new Date(0) })).toBeNull();
  });
  it("uses active points and a single partner rate with VAT and a known tariff zone", () => {
    expect(point.cityKey).toBe("москва");
    expect(point.details.days).toBe(4);
    expect(catalogPoint({ ...row, extStatus: "CLOSED" }, config, "A")).toBeNull();
    for (const change of [{ rateType: "other" }, { zone: "NULL" }, { zone: "" }, { rateCurrency: "USD" }, { rateValueWithVat: 0 }]) expect(catalogPoint({ ...row, rate: [{ ...row.rate[0], ...change }] }, config, "A")).toBeNull();
    expect(catalogPoint({ ...row, rate: [...row.rate, ...row.rate] }, config, "A")).toBeNull();
  });
  it("quotes one packed parcel in millimeters and milligrams using the contract's weight threshold", () => {
    vi.stubEnv("AUTH_SECRET", "synthetic-key");
    expect(fivePostQuote(point, cart, config)).toMatchObject({ cost: 185, price: 0, days: 4, parcel: { length: 200, width: 150, height: 80, weight: 1500000 } });
    expect(fivePostQuote(point, cart, { ...config, baseKg: 3, buyerPays: true })).toMatchObject({ cost: 150, price: 150 });
    expect(() => fivePostQuote({ ...point, details: { ...point.details, max: { ...point.details.max, weight: 1499999 } } }, cart, config)).toThrow("fivepost-size");
    expect(() => fivePostQuote({ ...point, details: { ...point.details, extra: 0 } }, cart, config)).toThrow("fivepost-tariff");
  });
  it("binds the point, price, address, contract, cart and deadline to the submitted quote", () => {
    vi.stubEnv("AUTH_SECRET", "synthetic-key");
    const quote = fivePostQuote(point, cart, config);
    expect(verifyFivePostQuote(quote.token, point, cart, config).price).toBe(0);
    expect(() => verifyFivePostQuote(quote.token, point, { ...cart, id: "other" }, config)).toThrow();
    expect(() => verifyFivePostQuote(quote.token, { ...point, address: "changed" }, cart, config)).toThrow();
    expect(() => verifyFivePostQuote(quote.token, point, cart, { ...config, buyerPays: true })).toThrow();
    expect(() => verifyFivePostQuote(quote.token.slice(0, -3), point, cart, config)).toThrow();
    expect(() => verifyFivePostQuote(fivePostQuote(point, cart, config, Date.now() - 1).token, point, cart, config)).toThrow();
  });
  it("builds a prepaid shipment with a stable cargo ID and the same packed dimensions used at checkout", () => {
    vi.stubEnv("AUTH_SECRET", "synthetic-key");
    const order = { number: "SID-1", customerName: "Покупатель", customerPhone: "+79990000000", deliveryPrice: 185, subtotal: 400, total: 585, items: [{ productName: "Товар", sku: "123", quantity: 2, unitPrice: 200 }] };
    const body = fivePostOrderBody(order, fivePostQuote(point, cart, config), "shop-warehouse");
    expect(body.partnerOrders[0]).toMatchObject({ receiverLocation: point.id, senderLocation: "shop-warehouse", clientOrderId: "SID-1", cost: { paymentType: "PREPAYMENT", paymentValue: 0, price: 400, deliveryCost: 185, prepaymentSum: 585 }, cargoes: [{ senderCargoId: "SID-1-1", weight: 1500000, height: 80, productValues: [{ vat: -1, value: 2, price: 200 }] }] });
  });
  it("uses the correct API environment and matches the returned order to the request", async () => {
    const mock = vi.fn().mockResolvedValueOnce(Response.json([{ senderOrderId: "another", orderId: randomUUID(), created: true }]));
    vi.stubGlobal("fetch", mock);
    const api = new FivePostClient({ ...config, environment: "test" }, async () => "test-jwt");
    await expect(api.create({ partnerOrders: [] }, "SID-1")).rejects.toThrow("fivepost-create-unconfirmed");
    expect(String(mock.mock.calls[0][0])).toBe("https://api-preprod-omni.x5.ru/api/v3/orders");
    expect(mock.mock.calls[0][1]).toMatchObject({ method: "POST", redirect: "error", headers: { Authorization: "Bearer test-jwt" } });
  });
});
