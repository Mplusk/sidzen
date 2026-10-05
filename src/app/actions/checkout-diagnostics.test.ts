import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ cart: vi.fn(), config: vi.fn(), verify: vi.fn(), consent: vi.fn(), checkout: vi.fn(), log: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.transaction } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => null }));
vi.mock("@/app/actions/cart", () => ({ getCart: m.cart }));
vi.mock("@/lib/order-access", () => ({ grantOrderAccess: vi.fn() }));
vi.mock("@/lib/payments", () => ({ onlinePaymentReady: async () => true, createOnlinePayment: vi.fn() }));
vi.mock("@/lib/diagnostics", () => ({ writeDiagnostic: m.log }));
vi.mock("@/lib/privacy", () => ({ operatorReady: async () => true, verifyDeliveryConsent: m.consent }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/lib/delivery/ozon-config", async o => ({ ...await o<typeof import("@/lib/delivery/ozon-config")>(), getOzonDeliveryConfig: m.config }));
vi.mock("@/lib/delivery/ozon-quote", async o => ({ ...await o<typeof import("@/lib/delivery/ozon-quote")>(), verifyOzonQuote: m.verify }));
vi.mock("@/lib/delivery/ozon-client", async o => ({ ...await o<typeof import("@/lib/delivery/ozon-client")>(), OzonDeliveryClient: class { checkout = m.checkout; } }));
import { OzonQuoteError } from "@/lib/delivery/ozon-quote";
import { OzonDeliveryError } from "@/lib/delivery/ozon-client";
import { createOrderAction } from "./checkout";
const form = () => {
  const f = new FormData(); for (const [k, v] of Object.entries({ name: "Synthetic buyer", email: "qa@example.test", phone: "+79991234567", delivery: "ozon-delivery", legal: "on", payment: "manual", expectedTotal: "240", ozonQuote: "signed-fixture", ozonConsent: "on" })) f.set(k, v); return f;
};
beforeEach(() => {
  vi.resetAllMocks(); m.log.mockResolvedValue("00000000-0000-4000-8000-000000000001");
  m.config.mockResolvedValue({ enabled: true, clientId: "app", clientSecret: "fixture", shipmentMethodId: 7, checkedAt: "2030-01-01Z", dispatchDays: 1 });
  m.cart.mockResolvedValue({ id: "cart", items: [{ available: true, quote: {}, unitPrice: 240, quantity: 1 }] });
  m.verify.mockReturnValue({ consentId: "consent", request: {}, cost: 180 }); m.checkout.mockResolvedValue({ cost: 180, days: 3 });
});
describe("checkout delivery failure diagnostics", () => {
  for (const reason of ["expired", "signature", "cart", "config", "phone"] as const) it(`reports exact ${reason} rejection without creating an order`, async () => {
    m.verify.mockImplementation(() => { throw new OzonQuoteError(reason); });
    await expect(createOrderAction(form())).rejects.toThrow(`error=ozon-${reason}&reference=`);
    expect(m.log).toHaveBeenCalledWith(`delivery.quote.${reason}`, expect.objectContaining({ stage: "verify" }));
    expect(m.checkout).not.toHaveBeenCalled(); expect(m.transaction).not.toHaveBeenCalled();
  });
  it("distinguishes missing consent from provider timeout", async () => {
    m.consent.mockRejectedValueOnce(new Error("delivery-consent-missing"));
    await expect(createOrderAction(form())).rejects.toThrow("error=ozon-consent"); expect(m.checkout).not.toHaveBeenCalled();
    m.checkout.mockRejectedValueOnce(new OzonDeliveryError("transport"));
    await expect(createOrderAction(form())).rejects.toThrow("error=ozon-transport");
    expect(m.log).toHaveBeenLastCalledWith("delivery.transport", expect.objectContaining({ stage: "recheck" })); expect(m.transaction).not.toHaveBeenCalled();
  });
  it("records changed carrier expense in kopecks and does not mistake redirect for an API error", async () => {
    m.checkout.mockResolvedValue({ cost: 181, days: 3 });
    await expect(createOrderAction(form())).rejects.toThrow("error=ozon-price");
    expect(m.log).toHaveBeenCalledTimes(1); expect(m.log).toHaveBeenCalledWith("delivery.price", { stage: "recheck", carrierCostKopecks: 18100, expectedCarrierCostKopecks: 18000 }); expect(m.transaction).not.toHaveBeenCalled();
  });
  it("does not expose raw exceptions with buyer details or secrets", async () => {
    m.checkout.mockRejectedValue(new Error("secret +79991234567 qa@example.test"));
    await expect(createOrderAction(form())).rejects.toThrow("error=ozon-provider");
    expect(JSON.stringify(m.log.mock.calls)).not.toContain("+7999"); expect(JSON.stringify(m.log.mock.calls)).not.toContain("secret");
  });
});
