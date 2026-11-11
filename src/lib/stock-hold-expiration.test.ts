import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ find: vi.fn(), orderUpdate: vi.fn(), paymentUpdate: vi.fn(), audit: vi.fn(), release: vi.fn(), lockProducts: vi.fn(), restoreCart: vi.fn(), ozon: vi.fn(), cdek: vi.fn() }));
vi.mock("@/lib/stock-reservations", () => ({ releaseUnsentStock: m.release }));
vi.mock("@/lib/late-order-stock", () => ({ EXPIRATION_MARKER: "stock-reservation-expired" }));
vi.mock("@/lib/order-cart-restore", () => ({ lockOrderProductsForCartReturn: m.lockProducts, returnOrderToCart: m.restoreCart }));
import { expireUnpaidOrderHold } from "./stock-hold-expiration";

const now = new Date("2030-01-01T12:00:00Z");
const order = { id: "order", kind: "ORDER", status: "AWAITING_PAYMENT", deletedAt: null, reservationExpiresAt: new Date(now.getTime() - 1), reservationExpiredAt: null, payment: { id: "payment", provider: "yookassa-online", status: "PENDING", externalId: "remote" }, shipment: null };
const db = { $transaction: (fn: (tx: unknown) => unknown) => fn({ $executeRaw: vi.fn(), order: { findUnique: m.find, update: m.orderUpdate }, payment: { update: m.paymentUpdate }, auditLog: { create: m.audit }, ozonDeliveryJob: { updateMany: m.ozon }, cdekDeliveryJob: { updateMany: m.cdek } }) } as unknown as PrismaClient;

describe("expired order holds", () => {
  beforeEach(() => { vi.resetAllMocks(); m.find.mockResolvedValue(order); m.release.mockResolvedValue(true); m.restoreCart.mockResolvedValue(true); });
  it("releases an unpaid expired reservation once and closes the unpaid order", async () => {
    expect(await expireUnpaidOrderHold(db, "order", now)).toBe(true);
    expect(m.release).toHaveBeenCalledWith(expect.anything(), "order");
    expect(m.restoreCart).toHaveBeenCalledWith(expect.anything(), order, now);
    expect(m.lockProducts.mock.invocationCallOrder[0]).toBeLessThan(m.release.mock.invocationCallOrder[0]);
    expect(m.orderUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "CANCELED", reservationExpiredAt: now, reservationExpiresAt: null }) }));
  });
  it.each([
    { ...order, reservationExpiresAt: new Date(now.getTime() + 1) },
    { ...order, reservationExpiredAt: now },
    { ...order, payment: { ...order.payment, status: "PAID" } },
    { ...order, payment: { ...order.payment, status: "AUTHORIZED" } },
  ])("does not release a live, paid or already expired hold", async value => {
    m.find.mockResolvedValue(value);
    expect(await expireUnpaidOrderHold(db, "order", now)).toBe(false);
    expect(m.release).not.toHaveBeenCalled();
  });
  it("keeps a hold if a shipment may already be in progress", async () => {
    m.release.mockResolvedValue(false);
    expect(await expireUnpaidOrderHold(db, "order", now)).toBe(false);
    expect(m.restoreCart).not.toHaveBeenCalled();
    expect(m.orderUpdate).not.toHaveBeenCalled();
  });
  it("marks a lost creation response for manual reconciliation without recreating a payment", async () => {
    m.find.mockResolvedValue({ ...order, payment: { ...order.payment, externalId: null, payload: { version: 1, request: "encrypted" } } });
    expect(await expireUnpaidOrderHold(db, "order", now)).toBe(true);
    expect(m.paymentUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { payload: { version: 1, request: "encrypted", reconciliationRequired: true } } }));
  });
});
