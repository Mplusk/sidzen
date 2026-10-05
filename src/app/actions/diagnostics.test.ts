import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ permission: vi.fn(), transaction: vi.fn(), remove: vi.fn(), audit: vi.fn(), lock: vi.fn(), limit: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePermission: m.permission }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.transaction } }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: m.limit }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
import { clearDiagnosticLogs } from "./diagnostics";
beforeEach(() => {
  vi.resetAllMocks(); m.permission.mockResolvedValue({ id: "admin" }); m.limit.mockReturnValue({ allowed: true }); m.remove.mockResolvedValue({ count: 9 });
  m.transaction.mockImplementation(fn => fn({ $executeRaw: m.lock, diagnosticLog: { deleteMany: m.remove }, auditLog: { create: m.audit } }));
});
describe("clear-all operational logs", () => {
  it("requires permission and server confirmation before deleting", async () => {
    await expect(clearDiagnosticLogs(new FormData())).rejects.toThrow("result=confirmation"); expect(m.permission).toHaveBeenCalledWith("settings.write"); expect(m.transaction).not.toHaveBeenCalled();
    m.permission.mockRejectedValue(new Error("forbidden")); const f = new FormData(); f.set("confirmation", "delete-all-diagnostic-logs");
    await expect(clearDiagnosticLogs(f)).rejects.toThrow("forbidden"); expect(m.transaction).not.toHaveBeenCalled();
  });
  it("deletes only diagnostic rows and preserves immutable audit and financial data", async () => {
    const f = new FormData(); f.set("confirmation", "delete-all-diagnostic-logs");
    await expect(clearDiagnosticLogs(f)).rejects.toThrow("result=cleared");
    expect(m.remove).toHaveBeenCalledWith({}); expect(m.lock).toHaveBeenCalled();
    expect(m.audit).toHaveBeenCalledWith({ data: { actorId: "admin", action: "diagnostics.clear", entityType: "DiagnosticLog", after: { deletedCount: 9 } } });
    expect(m.revalidate).toHaveBeenCalledWith("/account/logs/");
  });
  it("rate limits destructive requests", async () => {
    m.limit.mockReturnValue({ allowed: false }); const f = new FormData(); f.set("confirmation", "delete-all-diagnostic-logs");
    await expect(clearDiagnosticLogs(f)).rejects.toThrow("result=rate"); expect(m.transaction).not.toHaveBeenCalled();
  });
});
