import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ order: vi.fn(), consent: vi.fn(), transaction: vi.fn(), lock: vi.fn(), products: vi.fn(), currentOrder: vi.fn(), currentConsent: vi.fn(), create: vi.fn(), update: vi.fn(), audit: vi.fn(), checkout: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { order: { findUnique: m.order }, privacyConsent: { findFirst: m.consent }, $transaction: m.transaction } }));
vi.mock("@/lib/privacy", () => ({ operatorReady: async () => true }));
vi.mock("./ozon-config", () => ({ OZON_DELIVERY_CODE: "ozon-delivery", getOzonDeliveryConfig: async () => ({ enabled: true, clientId: "qa", shipmentMethodId: 7, dispatchDays: 1 }), requireOzonDelivery: () => {}, deliveryConfigFingerprint: () => "same" }));
vi.mock("./ozon-retry", () => ({ retryOzonQuote: async (_config: unknown, fn: (api: { checkout: typeof m.checkout }) => Promise<unknown>) => ({ value: await fn({ checkout: m.checkout }) }) }));
vi.mock("./ozon-worker", () => ({ ozonCreateBody: (request: unknown) => request }));

import { queueExistingOzonApplication } from "./ozon-applications";

const product = { id: "p1", name: "QA", madeToOrder: false, leadDays: 0, shippingWeightG: 100, shippingLengthMm: 100, shippingWidthMm: 100, shippingHeightMm: 100 };
const order = { id: "o1", number: "qa", updatedAt: new Date("2030-01-01T00:00:00Z"), deletedAt: null, kind: "APPLICATION", status: "NEW", customerPhone: "+79991234567", customerName: "QA", shipment: { id: "s1", provider: "ozon-delivery", tracking: null, payload: { pointId: 42 }, ozonJob: null }, items: [{ id: "i1", productId: "p1", productName: "QA", product, quantity: 1, unitPrice: 120, configuration: null }] };

beforeEach(() => {
  vi.clearAllMocks();
  m.order.mockResolvedValue(order);
  m.consent.mockResolvedValue({ id: "consent" });
  m.currentOrder.mockResolvedValue(order);
  m.currentConsent.mockResolvedValue({ id: "consent" });
  m.products.mockResolvedValue([product]);
  m.checkout.mockResolvedValue({ cost: 100 });
  m.create.mockResolvedValue({ id: "job" });
  m.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({ $executeRaw: m.lock, $queryRaw: m.lock, product: { findMany: m.products }, order: { findUnique: m.currentOrder }, privacyConsent: { findFirst: m.currentConsent }, ozonDeliveryJob: { create: m.create }, shipment: { update: m.update }, auditLog: { create: m.audit } }));
});

describe("repairing an existing Ozon application", () => {
  it("locks products and queues exactly the parcel that Ozon calculated", async () => {
    await expect(queueExistingOzonApplication("o1")).resolves.toBe("job");
    expect(m.lock).toHaveBeenCalledTimes(3);
    expect(m.create).toHaveBeenCalledOnce();
    expect(m.create.mock.calls[0][0].data.request.postings).toEqual(m.checkout.mock.calls[0][0].postings);
  });
  it("does not queue an outdated parcel if a product changes during the calculation", async () => {
    m.products.mockResolvedValue([{ ...product, shippingWeightG: 200 }]);
    await expect(queueExistingOzonApplication("o1")).rejects.toThrow("changed");
    expect(m.create).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });
  it("keeps a legacy application's stored order price as its declared value", async () => {
    m.products.mockResolvedValue([{ ...product, ozonDeclaredValue: "3500.00" }]);
    await expect(queueExistingOzonApplication("o1")).resolves.toBe("job");
    expect(m.create.mock.calls[0][0].data.request.postings[0].declared_value.amount).toBe("120.00");
  });
  it("does not queue a parcel if its product was removed", async () => {
    m.products.mockResolvedValue([]);
    await expect(queueExistingOzonApplication("o1")).rejects.toThrow("changed");
    expect(m.create).not.toHaveBeenCalled();
  });
});
