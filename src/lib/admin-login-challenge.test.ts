import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ get: vi.fn(), del: vi.fn(), find: vi.fn(), update: vi.fn(), create: vi.fn(), lock: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: m.get, delete: m.del }) }));
vi.mock("@/lib/smtp/client", () => ({ sendTransactionalMail: vi.fn() }));
vi.mock("@/lib/smtp/config", () => ({ SMTP_KEY: "smtp", getSmtpConfig: vi.fn() }));
vi.mock("@/lib/auth", () => ({ SESSION_COOKIE: "session" }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: (fn: (tx: unknown) => unknown) => fn({ $queryRaw: m.lock, $executeRaw: vi.fn(), siteSetting: { findUnique: async () => ({ value: true }) }, adminLoginChallenge: { findUnique: m.find, updateMany: m.update }, session: { create: m.create } }) } }));
import { consumeAdminLogin } from "./admin-login-challenge";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const token = "a".repeat(43), binding = "b".repeat(43);
const row = () => ({ id: "challenge", purpose: "login", userId: "user", bindingHash: digest(binding), email: "staff@example.test", passwordFingerprint: digest("stored-hash"), expiresAt: new Date(Date.now() + 60000), consumedAt: null, returnTo: "/admin", user: { isActive: true, email: "staff@example.test", passwordHash: "stored-hash", roles: [{ role: { code: "superadmin", permissions: [] } }] } });
beforeEach(() => {
  vi.clearAllMocks(); m.get.mockReturnValue({ value: binding });
  m.find.mockImplementation(async (args: { select?: unknown }) => args.select ? { userId: "user" } : row());
  m.update.mockResolvedValue({ count: 1 }); m.create.mockResolvedValue({});
});
it("creates a verified session only after the link and browser binding both match", async () => {
  const result = await consumeAdminLogin(token, "login");
  expect(result?.userId).toBe("user"); expect(result?.returnTo).toBe("/admin");
  expect(m.lock).toHaveBeenCalledOnce(); expect(m.create).toHaveBeenCalledOnce(); expect(m.del).toHaveBeenCalledOnce();
  m.get.mockReturnValue({ value: "c".repeat(43) });
  expect(await consumeAdminLogin(token, "login")).toBeNull(); expect(m.create).toHaveBeenCalledTimes(1);
});
it("rejects expired links, changed credentials, and replay without a session", async () => {
  for (const override of [{ expiresAt: new Date(Date.now() - 1000) }, { passwordFingerprint: digest("old-password") }, { consumedAt: new Date() }]) {
    m.find.mockImplementation(async (args: { select?: unknown }) => args.select ? { userId: "user" } : { ...row(), ...override });
    expect(await consumeAdminLogin(token, "login")).toBeNull();
  }
  expect(m.create).not.toHaveBeenCalled();
});
it("does not create a second session when another confirmation consumes the link", async () => {
  m.update.mockResolvedValue({ count: 0 });
  expect(await consumeAdminLogin(token, "login")).toBeNull(); expect(m.create).not.toHaveBeenCalled();
});
it("cannot turn an ordinary login link into an activation", async () => {
  expect(await consumeAdminLogin(token, "enroll")).toBeNull(); expect(m.create).not.toHaveBeenCalled();
});

