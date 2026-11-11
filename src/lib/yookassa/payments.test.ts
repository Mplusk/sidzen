import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ transaction: vi.fn(), find: vi.fn(), pending: vi.fn(), limit: vi.fn(), update: vi.fn(), orderUpdate: vi.fn(), orderUpdateOne: vi.fn(), audit: vi.fn(), settleUpdate: vi.fn(), cancelOzon: vi.fn(), cancelCdek: vi.fn(), release: vi.fn(), restore: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.transaction, payment: { findFirst: m.pending } } }));
vi.mock("@/lib/privacy", () => ({ operatorReady: async () => true }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: m.limit }));
vi.mock("@/lib/stock-reservations", () => ({ releaseUnsentStock: m.release }));
vi.mock("@/lib/late-order-stock", () => ({ restoreExpiredOrderStock: m.restore }));
import { applyYooKassaPayment, recoverUnboundYooKassaPayment } from "./payments";

const payment = { id: "payment", provider: "yookassa-online", orderId: "order", externalId: null, amount: 240, status: "PENDING", paidAt: null, payload: { version: 1, shopId: "123", firstAttemptAt: "2026-11-03T12:00:00.000Z", request: "encrypted" }, order: { id: "order", total: 240, currency: "RUB", deletedAt: null } };
const remote = { id: "28646d50-000f-5000-a000-1fe4f81e5e88", status: "succeeded" as const, paid: true, test: false, amount: { value: "240.00", currency: "RUB" as const }, metadata: { orderId: "order", paymentId: "payment" }, recipient: { account_id: "123" }, receipt_registration: "succeeded" as const };
describe("verified YooKassa payment", () => {
  beforeEach(() => {
    vi.resetAllMocks(); m.find.mockResolvedValue(payment); m.limit.mockReturnValue({ allowed: true });
    m.transaction.mockImplementation(callback => callback({ $executeRaw: vi.fn(), payment: { findUnique: m.find, update: m.update }, order: { updateMany: m.orderUpdate, update: m.orderUpdateOne }, auditLog: { create: m.audit }, yooKassaSettlement: { updateMany: m.settleUpdate }, ozonDeliveryJob: { updateMany: m.cancelOzon }, cdekDeliveryJob: { updateMany: m.cancelCdek } }));
  });
  it("does not contact the provider for unknown webhooks without an unbound payment or beyond the recovery limit", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    try {
      m.pending.mockResolvedValueOnce(null);
      await expect(recoverUnboundYooKassaPayment(remote.id)).rejects.toThrow("payment-state");
      m.pending.mockResolvedValueOnce({ id: "payment" }); m.limit.mockReturnValueOnce({ allowed: false });
      await expect(recoverUnboundYooKassaPayment(remote.id)).rejects.toThrow("payment-state");
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
  it("only marks an order paid from the verified provider response", async () => {
    await applyYooKassaPayment(remote);
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PAID", externalId: remote.id, payload: expect.objectContaining({ receiptStatus: "succeeded" }) }) }));
    expect(m.orderUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "PAID", reservationExpiresAt: null } }));
  });
  it.each([true, false])("records a verified late payment and requires stock review only if recovery fails (%s)", async recovered => {
    m.find.mockResolvedValue({ ...payment, order: { ...payment.order, status: "CANCELED", reservationExpiredAt: new Date() } });
    m.restore.mockResolvedValue(recovered);
    await applyYooKassaPayment(remote);
    expect(m.restore).toHaveBeenCalledWith(expect.anything(), "order");
    expect(m.orderUpdateOne).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PAID", stockReviewRequired: !recovered }) }));
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PAID" }) }));
  });
  it.each([{ recipient: { account_id: "other" } }, { amount: { value: "241.00", currency: "RUB" as const } }, { metadata: { orderId: "other", paymentId: "payment" } }])("rejects mismatched payment information", async change => {
    await expect(applyYooKassaPayment({ ...remote, ...change })).rejects.toThrow("payment-mismatch");
    expect(m.update).not.toHaveBeenCalled();
  });
  it("does not downgrade a paid order on a late pending response", async () => {
    m.find.mockResolvedValue({ ...payment, status: "PAID", externalId: remote.id, paidAt: new Date() });
    await applyYooKassaPayment({ ...remote, status: "pending", paid: false });
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PAID" }) }));
  });
  it("does not revive a canceled order after its stock was released", async () => {
    m.find.mockResolvedValue({ ...payment, status: "CANCELED", externalId: remote.id });
    await applyYooKassaPayment(remote);
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "CANCELED" }) }));
    expect(m.orderUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ data: { status: "PAID" } }));
  });
  it("blocks settlement after a partial refund", async () => {
    m.find.mockResolvedValue({ ...payment, status: "PAID", externalId: remote.id });
    await applyYooKassaPayment({ ...remote, refunded_amount: { value: "10.00", currency: "RUB" } });
    expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ refundReviewRequired: true }) }));
    expect(m.settleUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "MANUAL_REVIEW" }) }));
  });
  it("cancels unsent carrier jobs when the verified payment is canceled", async () => {
    await applyYooKassaPayment({ ...remote, status: "canceled", paid: false });
    expect(m.release).toHaveBeenCalledWith(expect.anything(), "order");
    expect(m.cancelOzon).toHaveBeenCalledOnce(); expect(m.cancelCdek).toHaveBeenCalledOnce();
  });
});
