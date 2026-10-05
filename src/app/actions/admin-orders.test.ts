import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ permission: vi.fn(), transaction: vi.fn(), find: vi.fn(), remove: vi.fn(), audit: vi.fn(), revalidate: vi.fn(), fiscalCount: vi.fn(), fiscalDelete: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePermission: mocks.permission }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));

import { deleteOrderAction } from "./admin-orders";

function form(confirmation?: string) {
  const data = new FormData();
  data.set("orderId", "order-1");
  if (confirmation) data.set("confirmation", confirmation);
  return data;
}

describe("order deletion", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.permission.mockResolvedValue({ id: "admin-1" });
    mocks.find.mockResolvedValue({ id: "order-1", number: "3DP-123", status: "NEW", total: "1200" });
    mocks.fiscalCount.mockResolvedValue(0);
    mocks.transaction.mockImplementation((callback) => callback({ $executeRaw: vi.fn(), order: { findUnique: mocks.find, delete: mocks.remove }, auditLog: { create: mocks.audit }, fiscalReceipt: { count: mocks.fiscalCount, deleteMany: mocks.fiscalDelete } }));
  });

  it("requires order management permission before accessing the order", async () => {
    mocks.permission.mockRejectedValue(new Error("forbidden"));
    await expect(deleteOrderAction(form("3DP-123"))).rejects.toThrow("forbidden");
    expect(mocks.permission).toHaveBeenCalledWith("orders.write");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("does not delete without a matching confirmation", async () => {
    await expect(deleteOrderAction(form())).rejects.toThrow("error=confirmation");
    expect(mocks.transaction).not.toHaveBeenCalled();
    await expect(deleteOrderAction(form("3DP-OTHER"))).rejects.toThrow("error=confirmation");
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("deletes the exact order and records an audit in the same transaction", async () => {
    await expect(deleteOrderAction(form("3DP-123"))).rejects.toThrow("redirect:/admin/orders/?deleted=3DP-123");
    expect(mocks.remove).toHaveBeenCalledWith({ where: { id: "order-1" } });
    expect(mocks.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ actorId: "admin-1", action: "order.delete", entityId: "order-1", before: { number: "3DP-123", status: "NEW", total: "1200" } }) });
    expect(mocks.revalidate).toHaveBeenCalledWith("/account", "layout");
  });

  it("handles an already deleted order without deleting anything else", async () => {
    mocks.find.mockResolvedValue(null);
    await expect(deleteOrderAction(form("3DP-123"))).rejects.toThrow("error=missing");
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("does not orphan an active or ambiguously created Ozon delivery", async () => {
    mocks.find.mockResolvedValue({ id: "order-1", number: "3DP-123", status: "NEW", total: "1200", shipment: { ozonJob: { status: "PENDING" } } });
    await expect(deleteOrderAction(form("3DP-123"))).rejects.toThrow("error=delivery-active");
    expect(mocks.remove).not.toHaveBeenCalled();
  });
  it("does not delete an active or ambiguously created bank payment", async () => {
    mocks.find.mockResolvedValue({ id: "order-1", number: "3DP-123", status: "AWAITING_PAYMENT", total: "1200", payment: { provider: "tochka", status: "PENDING", externalId: null, payload: { version: 1 } } });
    await expect(deleteOrderAction(form("3DP-123"))).rejects.toThrow("error=payment-active"); expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("reports a failed transaction instead of claiming successful deletion", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.transaction.mockRejectedValue(new Error("rollback"));
    await expect(deleteOrderAction(form("3DP-123"))).rejects.toThrow("error=delete");
    expect(mocks.revalidate).not.toHaveBeenCalled();
    log.mockRestore();
  });
  it("retains mandatory fiscal history instead of cascading its deletion", async () => {
    mocks.fiscalCount.mockResolvedValue(1);
    await expect(deleteOrderAction(form("3DP-123"))).rejects.toThrow("error=fiscal-history");
    expect(mocks.remove).not.toHaveBeenCalled(); expect(mocks.fiscalDelete).not.toHaveBeenCalled();
  });
});
