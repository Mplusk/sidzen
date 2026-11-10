import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ log: vi.fn(), ready: vi.fn(), config: vi.fn(), cart: vi.fn(), user: vi.fn(), point: vi.fn(), checkout: vi.fn(), record: vi.fn(), document: vi.fn(), postings: vi.fn() }));
vi.mock("@/lib/diagnostics", () => ({ writeDiagnostic: m.log }));
vi.mock("@/lib/prisma", () => ({ prisma: { privacyConsent: { create: m.record } } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: m.user, requirePermission: vi.fn() }));
vi.mock("@/lib/privacy", () => ({ operatorReady: m.ready, privacySubject: () => "hmac-not-raw-phone", consentDocument: m.document }));
vi.mock("@/app/actions/cart", () => ({ getCart: m.cart }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => ({ allowed: true }) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/delivery/ozon-config", async original => ({ ...await original<typeof import("@/lib/delivery/ozon-config")>(), getOzonDeliveryConfig: m.config }));
vi.mock("@/lib/delivery/ozon-client", async original => ({ ...await original<typeof import("@/lib/delivery/ozon-client")>(), OzonDeliveryClient: class { pointInfo = m.point; checkout = m.checkout; } }));
vi.mock("@/lib/delivery/ozon-quote", async original => ({ ...await original<typeof import("@/lib/delivery/ozon-quote")>(), buildOzonPostings: m.postings }));
import { quoteOzonDelivery } from "./ozon-delivery";
import { OzonDeliveryError } from "@/lib/delivery/ozon-client";
afterEach(() => vi.unstubAllEnvs());
describe("Ozon delivery quote boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks(); vi.stubEnv("AUTH_SECRET", "test-only");
    m.ready.mockResolvedValue(true); m.config.mockResolvedValue({ enabled: true, clientId: "test-app", clientSecret: "test-key", shipmentMethodId: 7, checkedAt: new Date().toISOString(), dispatchDays: 1 });
    m.cart.mockResolvedValue({ id: "cart", items: [{ id: "item", available: true, quantity: 1, unitPrice: 240, config: {}, product: { madeToOrder: false, leadDays: 1 } }] }); m.user.mockResolvedValue({ id: "owner" });
    m.point.mockResolvedValue([{ delivery_point_id: 8, is_active: true, full_address: "QA point" }]); m.postings.mockReturnValue([{ request_id: 1, shipment_method_id: 7, cutoff_at: new Date(Date.now() + 86400000).toISOString(), declared_value: { amount: "240.00", currency_code: "RUB" }, dimensions: { weight_g: 100, length_mm: 200, width_mm: 100, height_mm: 50 } }]);
    m.document.mockResolvedValue({ purpose: "ozon" }); m.record.mockResolvedValue({ id: "receipt", expiresAt: new Date(Date.now() + 900000) }); m.checkout.mockResolvedValue({ cost: 99, days: 2 });
  });
  it("does not call Ozon without an identified operator", async () => {
    m.ready.mockResolvedValue(false); await quoteOzonDelivery("+79991234567", "8");
    expect(m.point).not.toHaveBeenCalled(); expect(m.checkout).not.toHaveBeenCalled(); expect(m.record).not.toHaveBeenCalled();
  });
  it("rejects an invalid mobile number before contacting Ozon", async () => {
    const result = await quoteOzonDelivery("+70000000000", "8");
    expect(result).toMatchObject({ reason: "recipient" });
    expect(m.point).not.toHaveBeenCalled(); expect(m.checkout).not.toHaveBeenCalled(); expect(m.record).not.toHaveBeenCalled();
  });
  it("returns a signed short-lived quote without creating a consent record", async () => {
    const result = await quoteOzonDelivery("+79991234567", "8");
    expect(result).toMatchObject({ cost: 0, address: "QA point" });
    expect(m.record).not.toHaveBeenCalled(); expect(m.document).not.toHaveBeenCalled();
    expect(m.checkout).toHaveBeenCalledOnce();
    if (!("token" in result)) throw new Error("Expected delivery quote");
    const quote = JSON.parse(Buffer.from(result.token.split(".")[0], "base64url").toString());
    expect(quote).toMatchObject({ quoteVersion: 2, cost: 99 });
    expect(quote).not.toHaveProperty("consentId");
    expect(quote.expires - Date.now()).toBeGreaterThan(14 * 60000);
    expect(quote.expires - Date.now()).toBeLessThanOrEqual(15 * 60000);
  });
  it("fails closed when parcel measurements are missing", async () => {
    m.postings.mockImplementation(() => { throw new OzonDeliveryError("packaging"); });
    expect(await quoteOzonDelivery("+79991234567", "8")).toEqual({ error: expect.stringContaining("упаковки") }); expect(m.record).not.toHaveBeenCalled(); expect(m.checkout).not.toHaveBeenCalled();
  });
  it("identifies recipient rejection without misclassifying other delivery failures", async () => {
    m.checkout.mockRejectedValue(new OzonDeliveryError("recipient"));
    expect(await quoteOzonDelivery("+79991234567", "8")).toEqual({ error: expect.stringContaining("укажите другой номер"), reason: "recipient" });
    m.checkout.mockRejectedValue(new OzonDeliveryError("unavailable"));
    expect(await quoteOzonDelivery("+79991234567", "8")).toEqual({ error: expect.stringContaining("Не удалось рассчитать") });
  });
  it("reuses the same recipient and parcel data on retry", async () => {
    m.checkout.mockRejectedValueOnce(new OzonDeliveryError("transport"));
    const result = await quoteOzonDelivery("+79991234567", "8");
    expect(result).toMatchObject({ cost: 0, address: "QA point" });
    expect(m.record).not.toHaveBeenCalled(); expect(m.checkout).toHaveBeenCalledTimes(2);
    expect(m.checkout.mock.calls[0][0]).toEqual(m.checkout.mock.calls[1][0]);
  });
  it("explains restrictions and records only the verified public PVZ and sanitized failure", async () => {
    const error = new OzonDeliveryError("unavailable"); error.checkoutFailure = "point-restrictions"; error.expectedParcels = 1; error.receivedParcels = 1;
    m.checkout.mockRejectedValue(error);
    const result = await quoteOzonDelivery("+79991234567", "8");
    expect(result).toEqual({error: expect.stringContaining("ограничениях выбранного ПВЗ")});
    expect(m.log).toHaveBeenCalledWith("delivery.unavailable", expect.objectContaining({pointId: 8, checkoutFailure: "point-restrictions", expectedParcels: 1, receivedParcels: 1, attempts: 1}));
    expect(m.checkout).toHaveBeenCalledTimes(1); expect(JSON.stringify(m.log.mock.calls)).not.toMatch(/79991234567|test-key/);
  });
});
