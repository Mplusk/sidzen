import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ permission: vi.fn(), find: vi.fn(), update: vi.fn(), audit: vi.fn(), queue: vi.fn(), transaction: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePermission: m.permission }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.transaction } }));
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }));
vi.mock("@/lib/marketplaces/sync", () => ({ guardProductWrite: vi.fn() }));
vi.mock("@/lib/cloudkassir/lifecycle", () => ({ queueDerivedReceipt: m.queue }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
import { updateOrderStatusAction } from "./admin";
const request = (status: string, confirmed = false) => { const form = new FormData(); form.set("orderId", "order"); form.set("status", status); form.set("note", ""); if (confirmed) form.set("purchaseConfirmed", "on"); return form; };
beforeEach(() => {
  vi.resetAllMocks(); m.permission.mockResolvedValue({ id: "staff" });
  m.find.mockResolvedValue({ id: "order", number: "QA-1", kind: "APPLICATION", status: "NEW", deletedAt: null, purchaseConfirmedAt: null, payment: null, fiscalReceipts: [] });
  m.update.mockImplementation(async (query) => ({ id: "order", number: "QA-1", ...query.data }));
  m.transaction.mockImplementation(callback => callback({ $executeRaw: vi.fn(), order: { findUnique: m.find, update: m.update }, auditLog: { create: m.audit } }));
});
describe("manual application lifecycle", () => {
  it("requires order write permission", async () => { m.permission.mockRejectedValue(new Error("forbidden")); await expect(updateOrderStatusAction(request("IN_PROGRESS"))).rejects.toThrow("forbidden"); expect(m.transaction).not.toHaveBeenCalled(); });
  it("moves to in progress without payment or receipt and audits the change", async () => { await expect(updateOrderStatusAction(request("IN_PROGRESS"))).rejects.toThrow("saved=1"); expect(m.update).toHaveBeenCalledWith({ where: { id: "order" }, data: { status: "IN_PROGRESS", internalNote: null, purchaseConfirmedAt: null } }); expect(m.queue).not.toHaveBeenCalled(); expect(m.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "order.status.update", after: expect.objectContaining({ purchaseConfirmed: false }) }) }); });
  it.each(["PAID", "AWAITING_PAYMENT", "REFUNDED"])("rejects payment-driven status %s for an application", async status => { await expect(updateOrderStatusAction(request(status))).rejects.toThrow("application-status"); expect(m.update).not.toHaveBeenCalled(); });
  it("requires explicit attestation of purchase and handover before completion", async () => { await expect(updateOrderStatusAction(request("DELIVERED"))).rejects.toThrow("application-status"); expect(m.update).not.toHaveBeenCalled(); await expect(updateOrderStatusAction(request("DELIVERED", true))).rejects.toThrow("saved=1"); expect(m.update).toHaveBeenCalledWith({ where: { id: "order" }, data: { status: "DELIVERED", internalNote: null, purchaseConfirmedAt: expect.any(Date) } }); expect(m.queue).not.toHaveBeenCalled(); });
  it("withdraws the purchase attestation when reopened or canceled", async () => { m.find.mockResolvedValue({ id: "order", number: "QA-1", kind: "APPLICATION", status: "DELIVERED", purchaseConfirmedAt: new Date(), fiscalReceipts: [] }); await expect(updateOrderStatusAction(request("CANCELED"))).rejects.toThrow("saved=1"); expect(m.update).toHaveBeenCalledWith({ where: { id: "order" }, data: { status: "CANCELED", internalNote: null, purchaseConfirmedAt: null } }); });
  it("does not edit an archived application", async () => { m.find.mockResolvedValue({ id: "order", deletedAt: new Date() }); await expect(updateOrderStatusAction(request("IN_PROGRESS"))).rejects.toThrow("missing"); expect(m.update).not.toHaveBeenCalled(); });
});
