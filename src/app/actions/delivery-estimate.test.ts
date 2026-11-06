import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ permission: vi.fn(), transaction: vi.fn(), find: vi.fn(), update: vi.fn(), audit: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePermission: m.permission }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.transaction } }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
import { updateDeliveryEstimate } from "./delivery-estimate";

function form(date = "2030-01-09") {
  const data = new FormData();
  data.set("orderId", "order-1"); data.set("number", "3DP-TEST"); data.set("date", date);
  return data;
}
beforeEach(() => {
  vi.resetAllMocks(); m.permission.mockResolvedValue({ id: "admin" });
  m.find.mockResolvedValue({ number: "3DP-TEST", deletedAt: null, personalDataErasedAt: null, shipment: { id: "ship", payload: { pointId: 123, estimatedDays: 3 } } });
  m.transaction.mockImplementation(callback => callback({ $executeRaw: vi.fn(), order: { findUnique: m.find }, shipment: { update: m.update }, auditLog: { create: m.audit } }));
});
describe("manual delivery estimate", () => {
  it("requires order management permission and a valid calendar date", async () => {
    m.permission.mockRejectedValueOnce(new Error("forbidden"));
    await expect(updateDeliveryEstimate(form())).rejects.toThrow("forbidden");
    expect(m.transaction).not.toHaveBeenCalled();
    await expect(updateDeliveryEstimate(form("2030-02-29"))).rejects.toThrow("eta=invalid");
    expect(m.transaction).not.toHaveBeenCalled();
  });
  it("preserves the carrier data and audits the confirmed date", async () => {
    await expect(updateDeliveryEstimate(form())).rejects.toThrow("eta=saved");
    expect(m.update).toHaveBeenCalledWith({ where: { id: "ship" }, data: { payload: { pointId: 123, estimatedDays: 3, deliveryEstimateDate: "2030-01-09" } } });
    expect(m.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "shipment.estimate.update", before: { date: null }, after: { date: "2030-01-09" } }) });
    expect(m.revalidate).toHaveBeenCalledWith("/account", "layout");
  });
  it("clears only the manual date and refuses non-object legacy payloads", async () => {
    m.find.mockResolvedValueOnce({ number: "3DP-TEST", deletedAt: null, personalDataErasedAt: null, shipment: { id: "ship", payload: { pointId: 123, deliveryEstimateDate: "2030-01-09" } } });
    await expect(updateDeliveryEstimate(form(""))).rejects.toThrow("eta=saved");
    expect(m.update).toHaveBeenCalledWith({ where: { id: "ship" }, data: { payload: { pointId: 123 } } });
    m.update.mockClear();
    m.find.mockResolvedValueOnce({ number: "3DP-TEST", deletedAt: null, personalDataErasedAt: null, shipment: { id: "ship", payload: ["legacy"] } });
    await expect(updateDeliveryEstimate(form())).rejects.toThrow("eta=unsupported");
    expect(m.update).not.toHaveBeenCalled();
  });
});
