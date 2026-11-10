import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ cart: vi.fn(), create: vi.fn(), claim: vi.fn(), transaction: vi.fn(), verify: vi.fn(), tariff: vi.fn(), point: vi.fn(), config: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.transaction, deliveryMethod: { findFirst: vi.fn() } } }));
vi.mock("@/lib/yookassa/config", () => ({ getYooKassaConfig: async () => ({ enabled: false }), yookassaReady: () => false }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => ({ id: "buyer" }) }));
vi.mock("@/app/actions/cart", () => ({ getCart: m.cart }));
vi.mock("@/lib/stock-reservations", () => ({ reserveStock: async () => new Map([["p", 1]]) }));
vi.mock("@/lib/checkout-product-snapshot", () => ({ assertCheckoutProductsUnchanged: vi.fn() }));
vi.mock("@/lib/privacy", () => ({ operatorReady: async () => true, verifyDeliveryConsent: vi.fn() }));
vi.mock("@/lib/diagnostics", () => ({ writeDiagnostic: vi.fn() }));
vi.mock("@/lib/order-notifications", () => ({ sendOrderConfirmation: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/telegram/config", () => ({ queueTelegramOrder: vi.fn() }));
vi.mock("@/lib/delivery/cdek-config", () => ({ CDEK_DELIVERY_CODE: "cdek-delivery", getCdekConfig: m.config, requireCdek: vi.fn() }));
vi.mock("@/lib/delivery/cdek-quote", () => ({ verifyCdekQuote: m.verify, cdekConfigFingerprint: () => "config", cdekPackages: () => [{ weight: 100, length: 20, width: 10, height: 5 }] }));
vi.mock("@/lib/delivery/cdek-client", () => ({ CdekDeliveryClient: class { tariff = m.tariff; } }));
vi.mock("@/lib/delivery/cdek-points", () => ({ checkedCdekPoint: m.point }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
import { createOrderAction } from "./checkout";

function form(total = "504") { const f = new FormData(); for (const [key, value] of Object.entries({ name: "Synthetic buyer", email: "qa@example.test", phone: "+79991234567", delivery: "cdek-delivery", legal: "on", expectedTotal: total, cdekQuote: "signed" })) f.set(key, value); return f; }
beforeEach(() => {
  vi.resetAllMocks();
  m.cart.mockResolvedValue({ id: "cart", items: [{ id: "item", productId: "p", available: true, canStartCheckout: true, quantity: 1, unitPrice: 240, updatedAt: new Date(), product: { name: "QA product", sku: "QA" }, quote: { config: {} } }] });
  m.config.mockResolvedValue({ clientId: "account", environment: "test", senderCityCode: 44, senderPoint: "MOS4", senderName: "QA seller", senderPhone: "+79990000000" });
  m.verify.mockReturnValue({ config: "config", point: "MOS4", cityCode: 44, address: "QA point", tariff: 483, cost: 264, daysMin: 1, daysMax: 3 });
  m.tariff.mockResolvedValue({ total_sum: 264, currency: "RUB" }); m.claim.mockResolvedValue({ count: 1 }); m.create.mockResolvedValue({ id: "order", number: "QA-1" });
  m.transaction.mockImplementation(callback => callback({ $executeRaw: vi.fn(), cartItem: { deleteMany: m.claim }, order: { create: m.create }, auditLog: { create: vi.fn() } }));
});
describe("CDEK checkout", () => {
  it("adds delivery to the buyer total and atomically queues a shipment", async () => {
    await expect(createOrderAction(form())).rejects.toThrow("/checkout/success/QA-1/");
    const data = m.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ subtotal: 240, deliveryPrice: 264, total: 504, shippingAddress: "QA point" });
    expect(data.shipment.create).toMatchObject({ provider: "cdek-delivery", cost: 264, cdekJob: { create: { clientId: "account", request: { type: 2, tariff_code: 483, delivery_point: "MOS4", packages: [{ comment: "QA product" }] } } } });
    expect(data).not.toHaveProperty("payment");
  });
  it("does not create an order when the carrier cost changed", async () => {
    m.tariff.mockResolvedValue({ total_sum: 265, currency: "RUB" });
    await expect(createOrderAction(form())).rejects.toThrow("error=cdek");
    expect(m.transaction).not.toHaveBeenCalled();
  });
  it("does not allow the legacy free CDEK method to bypass tariff selection", async () => {
    const value = form("240"); value.set("delivery", "cdek"); value.set("city", "Москва"); value.set("address", "Тестовая улица, дом 1");
    await expect(createOrderAction(value)).rejects.toThrow("error=delivery");
    expect(m.transaction).not.toHaveBeenCalled();
  });
});
