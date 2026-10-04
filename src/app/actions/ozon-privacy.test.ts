import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ ready: vi.fn(), config: vi.fn(), cart: vi.fn(), user: vi.fn(), point: vi.fn(), checkout: vi.fn(), record: vi.fn(), document: vi.fn(), postings: vi.fn() }));
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
describe("Ozon phone transfer consent boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks(); vi.stubEnv("AUTH_SECRET", "test-only");
    m.ready.mockResolvedValue(true); m.config.mockResolvedValue({ enabled: true, clientId: "test-app", clientSecret: "test-key", shipmentMethodId: 7, checkedAt: new Date().toISOString(), dispatchDays: 1 });
    m.cart.mockResolvedValue({ id: "cart", items: [{ id: "item", available: true, quantity: 1, unitPrice: 240, config: {}, product: { madeToOrder: false, leadDays: 1 } }] }); m.user.mockResolvedValue({ id: "owner" });
    m.point.mockResolvedValue([{ delivery_point_id: 8, is_active: true, full_address: "QA point" }]); m.postings.mockReturnValue([{ request_id: 1, shipment_method_id: 7, cutoff_at: new Date(Date.now() + 86400000).toISOString(), declared_value: { amount: "240.00", currency_code: "RUB" }, dimensions: { weight_g: 100, length_mm: 200, width_mm: 100, height_mm: 50 } }]);
    m.document.mockResolvedValue({ purpose: "ozon" }); m.record.mockResolvedValue({ id: "receipt", expiresAt: new Date(Date.now() + 900000) }); m.checkout.mockResolvedValue({ cost: 99, days: 2 });
  });
  it("does not call Ozon without consent or identified operator", async () => {
    await quoteOzonDelivery("+79991234567", "8", false);
    m.ready.mockResolvedValue(false); await quoteOzonDelivery("+79991234567", "8", true);
    expect(m.point).not.toHaveBeenCalled(); expect(m.checkout).not.toHaveBeenCalled(); expect(m.record).not.toHaveBeenCalled();
  });
  it("stores evidence before phone transfer and binds returned quote to its receipt", async () => {
    const result = await quoteOzonDelivery("+79991234567", "8", true);
    expect(result).toMatchObject({ cost: 0, address: "QA point" });
    expect(m.record.mock.invocationCallOrder[0]).toBeLessThan(m.checkout.mock.invocationCallOrder[0]);
    expect(m.record.mock.calls[0][0].data).toMatchObject({ userId: "owner", subjectHash: "hmac-not-raw-phone", purpose: "ozon" });
    expect(JSON.stringify(m.record.mock.calls)).not.toContain("79991234567");
    if ("token" in result) expect(JSON.parse(Buffer.from(result.token.split(".")[0], "base64url").toString())).toMatchObject({ consentId: "receipt", cost: 99 });
  });
  it("fails closed if evidence cannot be saved or parcel measurements are missing", async () => {
    m.record.mockRejectedValue(new Error("database")); await quoteOzonDelivery("+79991234567", "8", true); expect(m.checkout).not.toHaveBeenCalled();
    m.postings.mockImplementation(() => { throw new OzonDeliveryError("packaging"); }); m.record.mockClear();
    expect(await quoteOzonDelivery("+79991234567", "8", true)).toEqual({ error: expect.stringContaining("упаковки") }); expect(m.record).not.toHaveBeenCalled(); expect(m.checkout).not.toHaveBeenCalled();
  });
});
