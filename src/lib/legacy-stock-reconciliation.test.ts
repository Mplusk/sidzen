import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ transaction: vi.fn(), order: vi.fn(), update: vi.fn(), audit: vi.fn(), raw: vi.fn(), execute: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.transaction } }));
import { confirmLegacyStock } from "./legacy-stock-reconciliation";
import { legacyStockReviewSnapshot } from "./legacy-stock-review-snapshot";
const original = { id: "order", number: "3DP-1", status: "PAID", inventoryTracked: false, deletedAt: null, personalDataErasedAt: null, items: [{ id: "item", productId: "p", quantity: 1, productName: "Товар" }], payment: { id: "payment", status: "PAID" }, shipment: { id: "shipment", provider: "ozon", ozonJob: { id: "job", status: "CREATED", response: null }, cdekJob: null } };
const snapshot = (value: unknown) => legacyStockReviewSnapshot(value as Parameters<typeof legacyStockReviewSnapshot>[0]);
const input = { orderId: "order", number: "3DP-1", actorId: "admin", reason: "Остаток проверен", products: [{ id: "p", stock: 3, reservedStock: 1 }], reviewSnapshot: snapshot(original) };
describe("legacy stock reconciliation", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.order.mockResolvedValue(original);
    m.raw.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValue([{ id: "p", stock: 3, reservedStock: 1 }]);
    m.transaction.mockImplementation(cb => cb({ $executeRaw: m.execute, $queryRaw: m.raw, order: { findUnique: m.order, update: m.update }, auditLog: { create: m.audit } }));
  });
  it("only marks a verified legacy order and records the stock snapshot", async () => {
    await confirmLegacyStock(input);
    expect(m.update).toHaveBeenCalledWith({ where: { id: "order" }, data: { inventoryTracked: true } });
    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actorId: "admin", action: "order.stock.legacy-reviewed" }) }));
  });
  it("rejects a changed physical balance or reservation", async () => {
    m.raw.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValue([{ id: "p", stock: 3, reservedStock: 2 }]);
    await expect(confirmLegacyStock(input)).rejects.toThrow("changed");
    expect(m.update).not.toHaveBeenCalled();
  });
  it("rejects a previously confirmed order", async () => {
    m.order.mockResolvedValue({ id: "order", number: "3DP-1", inventoryTracked: true, items: [] });
    await expect(confirmLegacyStock(input)).rejects.toThrow("changed");
    expect(m.update).not.toHaveBeenCalled();
  });
  it("permits verification if an old order was closed after migration", async () => {
    const closed = { ...original, status: "DELIVERED" };
    m.order.mockResolvedValue(closed);
    await confirmLegacyStock({ ...input, reviewSnapshot: snapshot(closed) });
    expect(m.update).toHaveBeenCalled();
  });
  it.each([
    ["order status", { ...original, status: "DELIVERED" }],
    ["order composition", { ...original, items: [{ ...original.items[0], quantity: 2 }] }],
    ["delivery status", { ...original, shipment: { ...original.shipment, deliveredAt: new Date() } }],
    ["carrier response", { ...original, shipment: { ...original.shipment, ozonJob: { ...original.shipment.ozonJob, status: "FINISHED" } } }],
    ["payment status", { ...original, payment: { ...original.payment, status: "REFUNDED" } }],
  ])("rejects changed %s after form was loaded", async (_description, fresh) => {
    m.order.mockResolvedValueOnce(original).mockResolvedValue(fresh);
    await expect(confirmLegacyStock(input)).rejects.toThrow("changed");
    expect(m.update).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  });
});
