import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ cart: vi.fn(), user: vi.fn(), method: vi.fn(), create: vi.fn(), audit: vi.fn(), claim: vi.fn(), transaction: vi.fn(), verify: vi.fn(), consent: vi.fn(), checkout: vi.fn(), grant: vi.fn(), bank: vi.fn(), notify: vi.fn(), paymentConfig: vi.fn(), createYoo: vi.fn(), reserve: vi.fn(), snapshot: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { deliveryMethod: { findFirst: m.method }, $transaction: m.transaction } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: m.user }));
vi.mock("@/app/actions/cart", () => ({ getCart: m.cart }));
vi.mock("@/lib/order-access", () => ({ setGuestGrantCookie: m.grant }));
vi.mock("@/lib/guest-order-grant", () => ({ createGuestGrant: async () => "v2.fixture" }));
vi.mock("@/lib/stock-reservations", () => ({ reserveStock: m.reserve }));
vi.mock("@/lib/checkout-product-snapshot", () => ({ assertCheckoutProductsUnchanged: m.snapshot }));
vi.mock("@/lib/payments", () => ({ createOnlinePayment: m.bank }));
vi.mock("@/lib/yookassa/config", () => ({ getYooKassaConfig: m.paymentConfig, yookassaReady: (config: { enabled: boolean }) => config.enabled }));
vi.mock("@/lib/yookassa/payments", () => ({ createYooKassaPayment: m.createYoo }));
vi.mock("@/lib/privacy", () => ({ operatorReady: async () => true, verifyDeliveryConsent: m.consent }));
vi.mock("@/lib/diagnostics", () => ({ writeDiagnostic: vi.fn() }));
vi.mock("@/lib/order-notifications", () => ({ sendOrderConfirmation: m.notify }));
vi.mock("@/lib/telegram/config", () => ({ queueTelegramOrder: vi.fn() }));
vi.mock("@/lib/delivery/ozon-config", () => ({ OZON_DELIVERY_CODE: "ozon-delivery", getOzonDeliveryConfig: async () => ({ clientId: "qa" }), requireOzonDelivery: vi.fn(), deliveryConfigFingerprint: () => "qa-config" }));
vi.mock("@/lib/delivery/ozon-quote", async original => ({ ...await original<typeof import("@/lib/delivery/ozon-quote")>(), verifyOzonQuote: m.verify }));
vi.mock("@/lib/delivery/ozon-retry", () => ({ retryOzonQuote: m.checkout }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
import { createOrderAction, createOrderWithState } from "./checkout";
function form(delivery = "pickup") { const value = new FormData(); for (const [key, field] of Object.entries({ name: "Synthetic buyer", phone: "+79991234567", email: "qa@example.test", delivery, legal: "on", expectedTotal: "240", ozonQuote: "qa-signed" })) value.set(key, field); return value; }
beforeEach(() => {
  vi.resetAllMocks(); m.user.mockResolvedValue({ id: "buyer" }); m.method.mockResolvedValue({ active: true, code: "pickup", name: "Pickup", basePrice: 0 });
  m.reserve.mockResolvedValue(new Map([["product", 1]])); m.snapshot.mockResolvedValue(undefined);
  m.paymentConfig.mockResolvedValue({ enabled: false }); m.createYoo.mockResolvedValue(null);
  m.cart.mockResolvedValue({ id: "cart", items: [{ id: "item", productId: "product", available: true, canStartCheckout: true, quantity: 1, unitPrice: 240, updatedAt: new Date(), product: { name: "QA product", sku: "QA" }, quote: { config: {} } }] });
  m.create.mockResolvedValue({ id: "application", number: "QA-1" }); m.claim.mockResolvedValue({ count: 1 }); m.notify.mockResolvedValue(undefined);
  m.verify.mockReturnValue({ config: "qa-config", cost: 125, days: 3, address: "QA pickup point", quoteVersion: 2, request: { recipient: { phone_number: "+79991234567" }, delivery: { delivery_point: { delivery_point_id: 42 } }, postings: [{ request_id: 1, shipment_method_id: 7, cutoff_at: "2030-01-01T12:00:00Z", declared_value: { amount: "240.00", currency_code: "RUB" }, dimensions: { weight_g: 100, length_mm: 200, width_mm: 100, height_mm: 50 } }] } });
  m.checkout.mockResolvedValue({ value: { cost: 125, days: 3 }, attempts: 1 });
  m.transaction.mockImplementation(callback => callback({ $executeRaw: vi.fn(), $queryRaw: vi.fn(), deliveryMethod: { findFirst: m.method }, cartItem: { deleteMany: m.claim }, order: { create: m.create }, auditLog: { create: m.audit }, privacyConsent: { update: vi.fn() } }));
});
describe("payment-free checkout application", () => {
  it.each([false, true])("keeps a legacy-blocked checkout in the form without provider requests or order/payment writes (online=%s)", async online => {
    m.paymentConfig.mockResolvedValue({ enabled: online });
    m.cart.mockResolvedValue({ id: "cart", items: [{ id: "item", productId: "product", available: false, canStartCheckout: true, stockReviewRequired: true, quantity: 1, unitPrice: 240, product: { name: "QA product", sku: "QA" }, quote: { config: {} } }] });
    const value = form("ozon-delivery"); if (online) value.set("paymentMode", "online");
    await expect(createOrderWithState({}, value)).resolves.toMatchObject({ error: "stock-review" });
    expect(m.verify).not.toHaveBeenCalled(); expect(m.checkout).not.toHaveBeenCalled(); expect(m.consent).not.toHaveBeenCalled();
    expect(m.transaction).not.toHaveBeenCalled(); expect(m.reserve).not.toHaveBeenCalled();
    expect(m.claim).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled(); expect(m.createYoo).not.toHaveBeenCalled();
    expect(m.notify).not.toHaveBeenCalled(); expect(m.grant).not.toHaveBeenCalled();
  });
  it.each([
    { scenario: "invalid configuration", canStartCheckout: false, quote: null },
    { scenario: "insufficient combined stock", canStartCheckout: false, quote: { config: {} } },
    { scenario: "missing quote despite a stale eligibility flag", canStartCheckout: true, quote: null },
  ])("does not let a legacy flag bypass $scenario", async ({ canStartCheckout, quote }) => {
    m.cart.mockResolvedValue({ id: "cart", items: [{ productId: "product", available: false, canStartCheckout, stockReviewRequired: true, quantity: 2, quote }] });
    await expect(createOrderAction(form())).rejects.toThrow("/cart/?error=unavailable");
    expect(m.transaction).not.toHaveBeenCalled(); expect(m.checkout).not.toHaveBeenCalled();
    expect(m.create).not.toHaveBeenCalled(); expect(m.createYoo).not.toHaveBeenCalled();
  });
  it("still blocks a legacy order discovered under the reservation lock before claiming the cart or creating payment", async () => {
    m.reserve.mockRejectedValue(new Error("stock-legacy-review"));
    m.paymentConfig.mockResolvedValue({ enabled: true });
    const value = form(); value.set("paymentMode", "online");
    await expect(createOrderWithState({}, value)).resolves.toMatchObject({ error: "stock-review" });
    expect(m.transaction).toHaveBeenCalledOnce(); expect(m.reserve).toHaveBeenCalledOnce();
    expect(m.claim).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled();
    expect(m.createYoo).not.toHaveBeenCalled(); expect(m.notify).not.toHaveBeenCalled();
  });
  it.each([undefined, "tochka", "yookassa", "manual"])("never creates a payment or receipt even with payment=%s", async payment => {
    const value = form(); if (payment) value.set("payment", payment);
    await expect(createOrderAction(value)).rejects.toThrow("/checkout/success/QA-1/");
    const data = m.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ kind: "APPLICATION", status: "NEW", userId: "buyer", total: 240 });
    expect(data).not.toHaveProperty("payment"); expect(data).not.toHaveProperty("fiscalReceipts"); expect(data.shipment.create).not.toHaveProperty("ozonJob");
    expect(m.bank).not.toHaveBeenCalled(); expect(m.grant).not.toHaveBeenCalled();
    expect(m.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "order.application.create" }) });
  });
  it("atomically queues a new Ozon shipment without a separate consent record", async () => {
    await expect(createOrderAction(form("ozon-delivery"))).rejects.toThrow("/checkout/success/QA-1/");
    const data = m.create.mock.calls[0][0].data;
    expect(data.shipment.create).toMatchObject({ provider: "ozon-delivery", payload: { pointId: 42, address: "QA pickup point" }, cost: 125 });
    expect(data.shipment.create.ozonJob.create).toMatchObject({ clientId: "qa", request: { recipient: { phone_number: "+79991234567", full_name: "Synthetic buyer" }, postings: [{ description: "QA product" }] } });
    expect(data).not.toHaveProperty("payment"); expect(data).not.toHaveProperty("fiscalReceipts"); expect(m.consent).not.toHaveBeenCalled();
  });
  it("continues checking a previously issued quote's consent before and inside the transaction", async () => {
    m.verify.mockReturnValue({ ...m.verify(), quoteVersion: undefined, consentId: "qa-consent" });
    await expect(createOrderAction(form("ozon-delivery"))).rejects.toThrow("/checkout/success/QA-1/");
    expect(m.consent).toHaveBeenCalledTimes(2);
    expect(m.consent).toHaveBeenCalledWith("qa-consent", "cart", "+79991234567");
  });
  it("does not create an order if a previous consent is revoked during checkout", async () => {
    m.verify.mockReturnValue({ ...m.verify(), quoteVersion: undefined, consentId: "qa-consent" });
    m.consent.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("delivery-consent-missing"));
    await expect(createOrderAction(form("ozon-delivery"))).rejects.toThrow("/cart/?error=changed");
    expect(m.consent).toHaveBeenCalledTimes(2);
    expect(m.claim).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled();
  });
  it("rolls back a concurrently claimed cart instead of submitting a duplicate", async () => { m.claim.mockResolvedValue({ count: 0 }); await expect(createOrderAction(form())).rejects.toThrow("/cart/?error=changed"); expect(m.create).not.toHaveBeenCalled(); });
  it("checks the product snapshot under the same transaction after reserving stock", async () => {
    m.snapshot.mockRejectedValue(new Error("product-changed"));
    await expect(createOrderAction(form())).rejects.toThrow("/cart/?error=changed");
    expect(m.reserve).toHaveBeenCalledOnce(); expect(m.snapshot).toHaveBeenCalledOnce();
    expect(m.snapshot.mock.calls[0][0]).toBe(m.reserve.mock.calls[0][0]);
    expect(m.reserve.mock.invocationCallOrder[0]).toBeLessThan(m.snapshot.mock.invocationCallOrder[0]);
    expect(m.create).not.toHaveBeenCalled();
  });
  it("sets the guest cookie only after its grant and order transaction commit", async () => {
    m.user.mockResolvedValue(null);
    let committed = false;
    m.transaction.mockImplementation(async callback => {
      const result = await callback({ $executeRaw: vi.fn(), $queryRaw: vi.fn(), deliveryMethod: { findFirst: m.method }, cartItem: { deleteMany: m.claim }, order: { create: m.create }, auditLog: { create: m.audit }, privacyConsent: { update: vi.fn() } });
      committed = true;
      return result;
    });
    m.grant.mockImplementation(async () => { expect(committed).toBe(true); });
    await expect(createOrderAction(form())).rejects.toThrow("/checkout/success/QA-1/");
    expect(m.grant).toHaveBeenCalledWith("QA-1", "v2.fixture");
  });
  it("creates an awaiting-payment order with the exact amount when online payment is enabled", async () => {
    m.paymentConfig.mockResolvedValue({ enabled: true });
    const value = form(); value.set("paymentMode", "online");
    await expect(createOrderAction(value)).rejects.toThrow("/checkout/success/QA-1/");
    expect(m.create.mock.calls[0][0].data).toMatchObject({ kind: "ORDER", status: "AWAITING_PAYMENT", total: 240, payment: { create: { provider: "yookassa-online", amount: 240, status: "PENDING" } } });
    expect(m.createYoo).toHaveBeenCalledWith("application");
  });
  it("does not unexpectedly charge a buyer who opened an application form before payment was enabled", async () => {
    m.paymentConfig.mockResolvedValue({ enabled: true });
    await expect(createOrderAction(form())).rejects.toThrow("error=payment-changed");
    expect(m.create).not.toHaveBeenCalled();
  });
});
