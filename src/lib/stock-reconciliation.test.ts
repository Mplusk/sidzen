import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ transaction: vi.fn(), order: vi.fn(), ozon: vi.fn(), cdek: vi.fn(), finish: vi.fn(), audit: vi.fn(), raw: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.transaction } }));
vi.mock("@/lib/stock-reservations", () => ({ finishStockReservations: m.finish }));
import { releaseReviewedStock } from "./stock-reconciliation";

const input = { orderId: "order", number: "3DP-1", reason: "Возврат на склад", actorId: "admin" };
const order = () => ({ id: "order", number: "3DP-1", status: "REFUNDED", personalDataErasedAt: null, deletedAt: null, payment: { status: "REFUNDED" }, shipment: { ozonJob: { id: "o" }, cdekJob: null }, items: [{ id: "item", productId: "p", stockReservationState: "ACTIVE", reservedStock: 1 }] });
describe("reviewed stock release", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.order.mockResolvedValue(order()); m.ozon.mockResolvedValue({ status: "CANCELED", lockToken: null });
    m.transaction.mockImplementation(cb => cb({ $executeRaw: m.raw, $queryRaw: m.raw, order: { findUnique: m.order }, ozonDeliveryJob: { findUnique: m.ozon }, cdekDeliveryJob: { findUnique: m.cdek }, auditLog: { create: m.audit } }));
  });
  it("releases and audits a verified return", async () => {
    await expect(releaseReviewedStock(input)).resolves.toBe("3DP-1");
    expect(m.finish).toHaveBeenCalledWith(expect.anything(), "order", "RELEASED");
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actorId: "admin", action: "order.stock.release.reviewed" }) }));
  });
  it.each([
    ["active order", { status: "SHIPPED" }], ["active payment", { payment: { status: "PAID" } }],
    ["wrong order number", { number: "3DP-OTHER" }], ["no reservation", { items: [] }],
    ["orphaned item", { items: [{ id: "i", productId: null, stockReservationState: "ACTIVE", reservedStock: 1 }] }],
  ])("rejects %s", async (_label, fields) => {
    m.order.mockResolvedValue({ ...order(), ...fields });
    await expect(releaseReviewedStock(input)).rejects.toThrow();
    expect(m.finish).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  });
  it.each([{ status: "CREATED", lockToken: null }, { status: "CANCELED", lockToken: "in-flight" }, null])("rejects active, leased or missing carrier record", async job => {
    m.ozon.mockResolvedValue(job);
    await expect(releaseReviewedStock(input)).rejects.toThrow("delivery-active");
    expect(m.finish).not.toHaveBeenCalled();
  });
});
