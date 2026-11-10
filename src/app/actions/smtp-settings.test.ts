import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ permission: vi.fn(), rate: vi.fn(), config: vi.fn(), verify: vi.fn(), save: vi.fn(), audit: vi.fn(), superadmin: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePermission: m.permission }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: m.rate }));
vi.mock("@/lib/smtp/config", () => ({ SMTP_KEY: "notifications.smtp.spaceweb", getSmtpConfig: m.config }));
vi.mock("@/lib/smtp/client", () => ({ verifySmtp: m.verify }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: (fn: (tx: unknown) => unknown) => fn({ $executeRaw: vi.fn(), user: { findFirst: m.superadmin }, siteSetting: { upsert: m.save }, auditLog: { create: m.audit } }) } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
import { saveSmtpSettings } from "./smtp-settings";
import { decryptSecret } from "@/lib/integration-secrets";
const config = { password: "fixture-secret", revision: "v1", checkedAt: "2026-01-01" };
function form(extra: Record<string, string> = {}) { const data = new FormData(); for (const [key, value] of Object.entries({ password: "", revision: "v1", ...extra })) data.set(key, value); return data; }
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("AUTH_SECRET", "qa-only"); m.permission.mockResolvedValue({ id: "admin", roles: ["superadmin"] }); m.superadmin.mockResolvedValue({ id: "admin" }); m.rate.mockReturnValue({ allowed: true }); m.config.mockResolvedValue(config); });

it("requires settings permission and rate limits before accessing secrets", async () => {
  m.permission.mockRejectedValueOnce(new Error("forbidden")); await expect(saveSmtpSettings(form())).rejects.toThrow("forbidden"); expect(m.config).not.toHaveBeenCalled();
  m.permission.mockResolvedValueOnce({ id: "admin", roles: ["admin"] }); await expect(saveSmtpSettings(form({ clearPassword: "on" }))).rejects.toThrow("/account/?error=forbidden"); expect(m.config).not.toHaveBeenCalled(); expect(m.save).not.toHaveBeenCalled();
  m.rate.mockReturnValueOnce({ allowed: false }); await expect(saveSmtpSettings(form())).rejects.toThrow("smtp-rate"); expect(m.config).not.toHaveBeenCalled();
});
it("encrypts the password, retains it on blank input and never audits it", async () => {
  await expect(saveSmtpSettings(form())).rejects.toThrow("smtp-saved");
  const stored = m.save.mock.calls[0][0].update.value;
  expect(stored.password).not.toBe(config.password); expect(decryptSecret(stored.password, "notifications.smtp.spaceweb")).toBe(config.password);
  expect(stored.checkedAt).toBe(config.checkedAt); expect(JSON.stringify(m.audit.mock.calls)).not.toContain(config.password); expect(m.verify).not.toHaveBeenCalled();
});
it("does not save when verification fails or settings changed concurrently", async () => {
  m.verify.mockRejectedValueOnce(new Error("fixture-secret")); await expect(saveSmtpSettings(form({ verify: "yes" }))).rejects.toThrow("smtp-connection"); expect(m.save).not.toHaveBeenCalled();
  m.config.mockResolvedValueOnce(config).mockResolvedValueOnce({ ...config, revision: "v2" });
  await expect(saveSmtpSettings(form({ verify: "yes" }))).rejects.toThrow("smtp-changed"); expect(m.save).not.toHaveBeenCalled();
});
it("does not save when the actor lost the superadmin role after authorization", async () => {
  m.superadmin.mockResolvedValueOnce(null);
  await expect(saveSmtpSettings(form({ clearPassword: "on" }))).rejects.toThrow("smtp-changed");
  expect(m.save).not.toHaveBeenCalled();
});
it("checks credentials on request and resets verification when changing or deleting them", async () => {
  await expect(saveSmtpSettings(form({ password: "new-fixture", verify: "yes" }))).rejects.toThrow("smtp-checked"); expect(m.save.mock.calls.at(-1)?.[0].update.value.checkedAt).toBeTruthy();
  await expect(saveSmtpSettings(form({ password: "new-fixture" }))).rejects.toThrow("smtp-saved"); expect(m.save.mock.calls.at(-1)?.[0].update.value.checkedAt).toBeNull();
  await expect(saveSmtpSettings(form({ clearPassword: "on" }))).rejects.toThrow("smtp-saved"); expect(m.save.mock.calls.at(-1)?.[0].update.value.password).toBe("");
  await expect(saveSmtpSettings(form({ clearPassword: "on", password: "new-fixture" }))).rejects.toThrow("smtp-invalid");
});

