import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ find: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { siteSetting: { findUnique: m.find } } }));
import { encryptSecret } from "@/lib/integration-secrets";
import { getSmtpConfig, getSmtpSettingsView, SMTP_KEY } from "./config";

beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("AUTH_SECRET", "qa-only"); });
it("decrypts only on the server and returns only a safe projection to the UI", async () => {
  const encrypted = encryptSecret("fixture-secret", SMTP_KEY);
  m.find.mockResolvedValue({ value: { password: encrypted, revision: "v1", checkedAt: "2026-01-01" } });
  expect((await getSmtpConfig()).password).toBe("fixture-secret");
  const view = await getSmtpSettingsView();
  expect(view).toEqual({ passwordConfigured: true, revision: "v1", checkedAt: "2026-01-01" });
  expect(JSON.stringify(view)).not.toContain("fixture-secret"); expect(JSON.stringify(view)).not.toContain(encrypted);
});
it("starts without a password when no settings exist", async () => {
  m.find.mockResolvedValue(null);
  expect(await getSmtpSettingsView()).toEqual({ passwordConfigured: false, revision: "", checkedAt: null });
});

