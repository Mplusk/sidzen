import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ permission: vi.fn(), limit: vi.fn(), transaction: vi.fn(), find: vi.fn(), update: vi.fn(), create: vi.fn(), audit: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePermission: m.permission }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: m.limit }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.transaction } }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
import { deleteDeliveryMethod, saveDeliveryMethod } from "./integrations";

const method = { id: "method-1", code: "cdek", name: "СДЭК", description: "Описание", basePrice: "490", sortOrder: 1, active: true, deletedAt: null };
function form(confirmation?: string) { const data = new FormData(); data.set("id", method.id); if (confirmation) data.set("confirmation", confirmation); return data; }
describe("delivery method deletion", () => {
  beforeEach(() => {
    vi.resetAllMocks(); m.permission.mockResolvedValue({ id: "admin" }); m.limit.mockReturnValue({ allowed: true }); m.find.mockResolvedValue(method); m.update.mockResolvedValue(method); m.create.mockResolvedValue(method);
    m.transaction.mockImplementation(callback => callback({ $executeRaw: vi.fn(), deliveryMethod: { findFirst: m.find, update: m.update, create: m.create }, auditLog: { create: m.audit } }));
  });
  it("requires settings permission and an exact per-method confirmation", async () => {
    m.permission.mockRejectedValueOnce(new Error("forbidden")); await expect(deleteDeliveryMethod(form(method.id))).rejects.toThrow("forbidden");
    expect(m.permission).toHaveBeenCalledWith("settings.write"); expect(m.transaction).not.toHaveBeenCalled();
    for (const value of [undefined, "other-id"]) await expect(deleteDeliveryMethod(form(value))).rejects.toThrow("delivery-confirmation");
    expect(m.update).not.toHaveBeenCalled();
  });
  it("archives only the selected method and records recovery details in the same transaction", async () => {
    await expect(deleteDeliveryMethod(form(method.id))).rejects.toThrow("result=delivery-deleted");
    expect(m.find).toHaveBeenCalledWith({ where: { id: method.id, deletedAt: null } });
    expect(m.update).toHaveBeenCalledWith({ where: { id: method.id }, data: { active: false, deletedAt: expect.any(Date) } });
    expect(m.audit).toHaveBeenCalledWith({ data: expect.objectContaining({ actorId: "admin", entityId: method.id, action: "integration.delivery.delete", before: expect.objectContaining({ name: "СДЭК", active: true, basePrice: "490" }) }) });
    expect(m.revalidate).toHaveBeenCalledWith("/", "layout");
  });
  it("does not alter another method or duplicate the audit when already removed", async () => {
    m.find.mockResolvedValue(null); await expect(deleteDeliveryMethod(form(method.id))).rejects.toThrow("delivery-missing");
    expect(m.update).not.toHaveBeenCalled(); expect(m.audit).not.toHaveBeenCalled();
  });
  it("does not claim success on database failure", async () => {
    m.transaction.mockRejectedValue(new Error("database")); await expect(deleteDeliveryMethod(form(method.id))).rejects.toThrow("database"); expect(m.revalidate).not.toHaveBeenCalled();
  });
  it("rate limits changes before accessing the database", async () => {
    m.limit.mockReturnValue({ allowed: false }); await expect(deleteDeliveryMethod(form(method.id))).rejects.toThrow("result=rate"); expect(m.transaction).not.toHaveBeenCalled();
  });
  it("rejects a stale edit of a removed method instead of resurrecting it", async () => {
    m.find.mockResolvedValue(null); const edit = form();
    for (const [key, value] of Object.entries({ name: "СДЭК", description: "", basePrice: "490", sortOrder: "1", active: "on" })) edit.set(key, value);
    await expect(saveDeliveryMethod(edit)).rejects.toThrow("delivery-missing"); expect(m.update).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled();
  });
});
