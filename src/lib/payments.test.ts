import { beforeEach, describe, expect, it, vi } from "vitest";
const db = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), order: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: (fn: (tx: unknown) => unknown) => fn({ payment: { findUnique: db.find, updateMany: db.update }, order: { updateMany: db.order }, auditLog: { create: db.audit } }) } }));
import { applyVerifiedPayment, onlinePaymentReady, type VerifiedPayment } from "./payments";
const remote: VerifiedPayment = { id: "11111111-1111-4111-8111-111111111111", status: "succeeded", paid: true, amount: { value: "1490.00", currency: "RUB" }, metadata: { orderId: "order-1" }, recipient: { account_id: "shop-1" } };
beforeEach(() => { vi.clearAllMocks(); vi.unstubAllEnvs(); vi.stubEnv("YOOKASSA_SHOP_ID", "shop-1"); db.find.mockResolvedValue({ id: "payment-1", orderId: "order-1", provider: "yookassa", amount: 1490, externalId: remote.id, order: { total: 1490 } }); db.update.mockResolvedValue({ count: 1 }); });
describe("verified online payments", () => {
  it("is disabled until credentials and fiscalization mode are configured", () => { expect(onlinePaymentReady()).toBe(false); vi.stubEnv("PAYMENT_PROVIDER", "yookassa"); vi.stubEnv("YOOKASSA_SECRET_KEY", "test"); expect(onlinePaymentReady()).toBe(false); vi.stubEnv("YOOKASSA_VAT_CODE", "1"); expect(onlinePaymentReady()).toBe(true); });
  it("updates a matched payment and eligible order exactly once", async () => { await applyVerifiedPayment(remote); expect(db.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "payment-1", status: { in: ["PENDING", "AUTHORIZED"] } }, data: expect.objectContaining({ status: "PAID" }) })); expect(db.order).toHaveBeenCalledTimes(1); expect(db.audit).toHaveBeenCalledTimes(1); db.update.mockResolvedValue({ count: 0 }); await applyVerifiedPayment(remote); expect(db.order).toHaveBeenCalledTimes(1); expect(db.audit).toHaveBeenCalledTimes(1); });
  it("rejects amount, payment ID, merchant and test-mode mismatches", async () => {
    for (const change of [{ amount: { value: "1", currency: "RUB" as const } }, { id: "22222222-2222-4222-8222-222222222222" }, { recipient: { account_id: "other" } }, { test: true }]) await expect(applyVerifiedPayment({ ...remote, ...change })).rejects.toThrow();
    expect(db.update).not.toHaveBeenCalled();
  });
  it("does not treat an unpaid succeeded event or pending state as payment", async () => { await applyVerifiedPayment({ ...remote, paid: false }); await applyVerifiedPayment({ ...remote, status: "pending" }); expect(db.update).not.toHaveBeenCalled(); });
  it("cancels the payment without marking the order paid", async () => { await applyVerifiedPayment({ ...remote, status: "canceled", paid: false }); expect(db.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "CANCELED", externalId: remote.id } })); expect(db.order).not.toHaveBeenCalled(); });
});
