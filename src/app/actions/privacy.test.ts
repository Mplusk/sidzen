import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: vi.fn(), permission: vi.fn(), create: vi.fn(), revoke: vi.fn(), update: vi.fn(), audit: vi.fn(), tx: vi.fn(), rate: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireUser: m.user, requirePermission: m.permission, SESSION_COOKIE: "3dp_session" }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.tx } }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: m.rate }));
vi.mock("@/lib/privacy", () => ({ rfStorageReady: () => true }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error("redirect:" + url); } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "fixture" }) }) }));
import { answerPersonalDataRequest, requestPersonalData } from "./privacy";
describe("privacy requests authorization", () => {
  beforeEach(() => { vi.resetAllMocks(); m.user.mockResolvedValue({ id: "owner" }); m.permission.mockResolvedValue({ id: "staff" }); m.rate.mockReturnValue({ allowed: true }); m.tx.mockImplementation(fn => fn({ $executeRaw: vi.fn(), socialAccount: { deleteMany: vi.fn() }, oAuthAttempt: { deleteMany: vi.fn() }, session: { deleteMany: vi.fn() }, privacyRequest: { create: m.create, update: m.update }, privacyConsent: { updateMany: m.revoke }, auditLog: { create: m.audit } })); });
  it("ignores forged user IDs and revokes only this buyer's pre-order permissions", async () => {
    const form = new FormData(); form.set("userId", "victim"); form.set("type", "WITHDRAW"); form.set("message", "Withdraw consent");
    await expect(requestPersonalData(form)).rejects.toThrow("sent=1");
    expect(m.create).toHaveBeenCalledWith({ data: { userId: "owner", type: "WITHDRAW", message: "Withdraw consent" } });
    expect(m.revoke.mock.calls[0][0].where).toEqual({ userId: "owner", purpose: "ozon", revokedAt: null });
  });
  it("rejects anonymous requests and unprivileged staff before writing", async () => {
    m.user.mockRejectedValue(new Error("login")); await expect(requestPersonalData(new FormData())).rejects.toThrow("login");
    m.permission.mockRejectedValue(new Error("forbidden")); await expect(answerPersonalDataRequest(new FormData())).rejects.toThrow("forbidden");
    expect(m.tx).not.toHaveBeenCalled();
  });
  it("requires a substantive response and never implies actual data destruction", async () => {
    const form = new FormData(); form.set("id", "request"); form.set("status", "RESOLVED"); form.set("response", "");
    await expect(answerPersonalDataRequest(form)).rejects.toThrow("invalid"); expect(m.update).not.toHaveBeenCalled();
    form.set("response", "Response explaining actual retention"); await answerPersonalDataRequest(form);
    expect(m.permission).toHaveBeenCalledWith("users.write"); expect(m.audit.mock.calls[0][0].data.after).toEqual({ status: "RESOLVED" });
  });
});
