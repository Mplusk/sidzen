import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), updateMany: vi.fn(), orderUpdate: vi.fn(), audit: vi.fn(), config: vi.fn(), orderFind: vi.fn(), request: vi.fn(), get: vi.fn(), privacy: vi.fn(), raw: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { order: { findUniqueOrThrow: m.orderFind }, payment: { findUnique: m.find, updateMany: m.updateMany }, $transaction: (fn: (tx: unknown) => unknown) => fn({ $queryRaw: m.raw, $executeRaw: m.raw, payment: { findUnique: m.find, findUniqueOrThrow: m.find, update: m.update, updateMany: m.updateMany }, order: { updateMany: m.orderUpdate }, auditLog: { create: m.audit } }) } }));
vi.mock("@/lib/tochka/config", async importOriginal => ({ ...await importOriginal<object>(), getTochkaConfig: m.config }));
vi.mock("@/lib/tochka/client", async importOriginal => ({ ...await importOriginal<object>(), tochkaRequest: m.request, getTochkaOperation: m.get }));
vi.mock("@/lib/privacy", () => ({ operatorReady: m.privacy }));
import { applyTochkaPayment, createOnlinePayment, onlinePaymentReady, recoverTochkaOperation } from "@/lib/payments";
import type { TochkaOperation } from "./client";
const config = { enabled: true, token: "qa-only-synthetic-jwt-token", customerCode: "1234567ab", merchantId: "200000000001097", card: true, sbp: true, receiptMode: "provider", vatType: "none", taxSystemCode: "usn_income", externalReceiptsConfirmed: false, checkedAt: "2026-10-05T00:00:00.000Z" };
const binding = { version: 1, requestedAt: "2026-10-05T00:00:00.000Z", customerCode: config.customerCode, merchantId: config.merchantId, paymentLinkId: "payment-1" };
const remote: TochkaOperation = { operationId: "bank-1", status: "APPROVED", amount: 1490, customerCode: config.customerCode, merchantId: config.merchantId, paymentLinkId: "payment-1", paymentLink: "https://merch.tochka.com/order/qa-only" };
const payment = { id: "payment-1", provider: "tochka", orderId: "order-1", status: "PENDING", amount: 1490, externalId: "bank-1", payload: binding, order: { total: 1490, currency: "RUB", status: "AWAITING_PAYMENT" } };
beforeEach(() => { vi.clearAllMocks(); m.config.mockResolvedValue(config); m.find.mockResolvedValue(payment); m.updateMany.mockResolvedValue({ count: 1 }); m.privacy.mockResolvedValue(true); });
describe("verified Tochka payments", () => {
  it("requires verified configuration and operator readiness before claiming or sending buyer data", async () => {
    m.config.mockResolvedValue({ ...config, enabled: false }); expect(await onlinePaymentReady()).toBe(false);
    m.orderFind.mockResolvedValue({ id: "order-1", status: "AWAITING_PAYMENT", currency: "RUB", payment: { ...payment, externalId: null, payload: null } }); m.privacy.mockResolvedValue(false);
    await expect(createOnlinePayment("order-1")).rejects.toThrow("personal-data-not-ready"); expect(m.request).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled();
  });
  it("binds exact company, merchant, amount, operation and paymentLinkId before marking paid", async () => {
    for (const change of [{ amount: 1490.001 }, { amount: 1 }, { customerCode: "different" }, { merchantId: "different" }, { paymentLinkId: "different" }, { operationId: "different" }]) {
      await expect(applyTochkaPayment(payment.id, { ...remote, ...change })).rejects.toThrow("payment-mismatch");
    }
    expect(m.updateMany).not.toHaveBeenCalled(); await applyTochkaPayment(payment.id, remote);
    expect(m.orderUpdate).toHaveBeenCalledWith({ where: { id: "order-1", status: { in: ["NEW", "APPROVED", "AWAITING_PAYMENT"] } }, data: { status: "PAID" } });
    m.updateMany.mockResolvedValue({ count: 0 }); await applyTochkaPayment(payment.id, remote); expect(m.orderUpdate).toHaveBeenCalledTimes(1); expect(m.audit).toHaveBeenCalledTimes(1);
  });
  it("never treats a hold, partial payment, expired link or refund as paid", async () => {
    for (const status of ["AUTHORIZED", "WAIT_FULL_PAYMENT", "CREATED", "EXPIRED", "REFUNDED", "ON-REFUND", "REFUNDED_PARTIALLY"] as const) await applyTochkaPayment(payment.id, { ...remote, status });
    expect(m.orderUpdate).not.toHaveBeenCalled(); expect(m.updateMany).toHaveBeenCalledTimes(2);
  });
  it("does not match a rouble bank payment to an order in another currency", async () => {
    m.find.mockResolvedValue({ ...payment, order: { ...payment.order, currency: "USD" } });
    await expect(applyTochkaPayment(payment.id, remote)).rejects.toThrow("payment-currency"); expect(m.orderUpdate).not.toHaveBeenCalled();
  });
  it("reopens an existing link even after disabling new payments", async () => {
    m.config.mockResolvedValue({ ...config, enabled: false }); m.orderFind.mockResolvedValue({ id: "order-1", status: "AWAITING_PAYMENT", currency: "RUB", payment }); m.get.mockResolvedValue({ ...remote, status: "CREATED" });
    expect(await createOnlinePayment("order-1")).toBe(remote.paymentLink); expect(m.request).not.toHaveBeenCalled();
  });
  it("recovers an ambiguous request by unique link ID and never repeats the creation POST", async () => {
    m.find.mockResolvedValue({ ...payment, externalId: null }); m.orderFind.mockResolvedValue({ id: "order-1", status: "AWAITING_PAYMENT", currency: "RUB", payment: { ...payment, externalId: null } });
    m.request.mockResolvedValue({ Data: { Operation: [remote] }, Meta: { totalPages: 1 } }); m.get.mockResolvedValue({ ...remote, status: "CREATED" });
    expect(await createOnlinePayment("order-1")).toBe(remote.paymentLink);
    expect(m.request).toHaveBeenCalledTimes(1); expect(m.request.mock.calls[0]).toHaveLength(2); expect(m.request.mock.calls[0][1]).toContain("fromDate=");
  });
  it("requires reconciliation when the bank cannot find a timed-out request", async () => {
    m.orderFind.mockResolvedValue({ id: "order-1", status: "AWAITING_PAYMENT", currency: "RUB", payment: { ...payment, externalId: null } }); m.find.mockResolvedValue({ ...payment, externalId: null }); m.request.mockResolvedValue({ Data: { Operation: [] }, Meta: { totalPages: 1 } });
    await expect(createOnlinePayment("order-1")).rejects.toThrow("payment-reconciliation-required"); expect(m.request.mock.calls[0]).toHaveLength(2);
  });
  it("rejects duplicate remote links instead of choosing an arbitrary charge", async () => {
    m.request.mockResolvedValue({ Data: { Operation: [remote, { ...remote, operationId: "bank-2" }] }, Meta: { totalPages: 1 } });
    await expect(recoverTochkaOperation(config as never, payment.id, binding.requestedAt)).rejects.toThrow("payment-duplicate-bank-link");
  });
  it("creates one-phase goods prepayment with email-only receipt and free delivery", async () => {
    const local = { ...payment, externalId: null, payload: null };
    m.orderFind.mockResolvedValue({ id: "order-1", number: "3DP-QA", status: "AWAITING_PAYMENT", currency: "RUB", payment: local, total: 1490, deliveryPrice: 0, customerEmail: "qa@example.test", customerPhone: "+79990000000", items: [{ productName: "QA product", unitPrice: 745, quantity: 2 }] });
    m.find.mockResolvedValueOnce(local).mockResolvedValueOnce(payment).mockResolvedValue(payment); m.get.mockResolvedValue({ ...remote, status: "CREATED" }); m.request.mockResolvedValue({ Data: { operationId: "bank-1", amount: 1490, merchantId: config.merchantId } });
    expect(await createOnlinePayment("order-1")).toBe(remote.paymentLink);
    expect(m.update).toHaveBeenCalledWith({ where: { id: payment.id }, data: { payload: expect.objectContaining({ paymentLinkId: payment.id, merchantId: config.merchantId }) } });
    const [savedConfig, endpoint, body] = m.request.mock.calls[0]; expect(savedConfig).toEqual(config); expect(endpoint).toBe("acquiring/v1.0/payments_with_receipt");
    expect(body.Data).toMatchObject({ amount: 1490, preAuthorization: false, saveCard: false, paymentMode: ["card", "sbp"], Client: { email: "qa@example.test" }, Items: [{ amount: 745, quantity: 2, paymentObject: "goods", paymentMethod: "full_prepayment", vatType: "none" }] });
    expect(JSON.stringify(body)).not.toContain("+79990000000"); expect(m.request).toHaveBeenCalledTimes(1);
  });
});
