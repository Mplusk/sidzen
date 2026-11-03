import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ permission: vi.fn(), config: vi.fn(), check: vi.fn(), transaction: vi.fn(), save: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePermission: m.permission }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: m.transaction } }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: () => ({ allowed: true }) }));
vi.mock("@/lib/integrations", () => ({ checkYookassa: m.check }));
vi.mock("@/lib/yookassa/config", async original => ({ ...await original<typeof import("@/lib/yookassa/config")>(), getYooKassaConfig: m.config }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); } }));
import { saveYooKassaSettings } from "./yookassa-settings";

function form(enabled = false, confirmed = false) {
  const data = new FormData(); data.set("shopId", "123"); data.set("secret", "fixture-secret");
  if (enabled) data.set("enabled", "on"); if (confirmed) data.set("receiptsConfirmed", "on"); return data;
}
beforeEach(() => {
  vi.unstubAllEnvs(); vi.resetAllMocks(); vi.stubEnv("AUTH_SECRET", "fixture-only-encryption-key");
  m.permission.mockResolvedValue({ id: "admin" }); m.config.mockResolvedValue({ enabled: false, shopId: "", secret: "", receiptsConfirmed: false });
  m.check.mockResolvedValue({ account_id: "123", test: false, status: "enabled" });
  m.transaction.mockImplementation(callback => callback({ $executeRaw: vi.fn(), payment: { count: vi.fn().mockResolvedValue(0) }, siteSetting: { upsert: m.save }, auditLog: { create: m.audit } }));
});
describe("YooKassa activation", () => {
  it("requires explicit confirmation of the receipt service before enabling", async () => {
    await expect(saveYooKassaSettings(form(true, false))).rejects.toThrow("yookassa-receipts");
    expect(m.check).not.toHaveBeenCalled(); expect(m.save).not.toHaveBeenCalled();
  });
  it("does not accept a sandbox merchant on the production site", async () => {
    vi.stubEnv("NODE_ENV", "production"); m.check.mockResolvedValue({ account_id: "123", test: true });
    await expect(saveYooKassaSettings(form(true, true))).rejects.toThrow("yookassa-connection");
    expect(m.save).not.toHaveBeenCalled();
  });
  it("checks the merchant and stores its secret encrypted before enabling", async () => {
    await expect(saveYooKassaSettings(form(true, true))).rejects.toThrow("yookassa-checked");
    const value = m.save.mock.calls[0][0].create.value;
    expect(value.enabled).toBe(true); expect(value.secret).not.toContain("fixture-secret"); expect(m.check).toHaveBeenCalledOnce();
  });
});
