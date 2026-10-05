import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ permission: vi.fn(), rate: vi.fn(), config: vi.fn(), check: vi.fn(), count: vi.fn(), save: vi.fn(), audit: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePermission: m.permission }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: m.rate }));
vi.mock("@/lib/tochka/config", async original => ({ ...await original<object>(), getTochkaConfig: m.config }));
vi.mock("@/lib/tochka/client", () => ({ checkTochka: m.check }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: (fn: (tx: unknown) => unknown) => fn({ $executeRaw: vi.fn(), payment: { count: m.count }, siteSetting: { upsert: m.save }, auditLog: { create: m.audit } }) } }));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidate }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
import { savePaymentIntegration } from "./integrations";
import { decryptSecret } from "@/lib/integration-secrets";
const config = { enabled: false, token: "qa-only-bank-jwt-token", customerCode: "1234567ab", merchantId: "200000000001097", card: true, sbp: true, receiptMode: "provider", vatType: "none", taxSystemCode: "usn_income", externalReceiptsConfirmed: false };
function form(extra: Record<string, string> = {}) { const result = new FormData(); for (const [key, value] of Object.entries({ customerCode: config.customerCode, merchantId: config.merchantId, token: "", card: "on", sbp: "on", receiptMode: "provider", vatType: "none", taxSystemCode: "usn_income", ...extra })) result.set(key, value); return result; }
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("AUTH_SECRET", "qa-only"); m.permission.mockResolvedValue({ id: "admin" }); m.rate.mockReturnValue({ allowed: true }); m.config.mockResolvedValue(config); m.count.mockResolvedValue(0); });
describe("Tochka administrator settings", () => {
  it("enforces settings.write and rate limiting before exposing credentials", async () => {
    m.permission.mockRejectedValueOnce(new Error("forbidden")); await expect(savePaymentIntegration(form())).rejects.toThrow("forbidden"); expect(m.config).not.toHaveBeenCalled();
    m.rate.mockReturnValue({ allowed: false }); await expect(savePaymentIntegration(form())).rejects.toThrow("result=rate"); expect(m.config).not.toHaveBeenCalled();
  });
  it("encrypts the saved JWT, retains blank input and excludes it from audit", async () => {
    await expect(savePaymentIntegration(form())).rejects.toThrow("result=saved");
    const value = m.save.mock.calls[0][0].update.value;
    expect(decryptSecret(value.token, "integrations.tochka")).toBe(config.token); expect(JSON.stringify(m.audit.mock.calls)).not.toContain(config.token); expect(m.check).not.toHaveBeenCalled();
  });
  it("checks a read-only connection before enabling and never saves a failed verification", async () => {
    m.check.mockRejectedValueOnce(new Error("bank-failed")); await expect(savePaymentIntegration(form({ enabled: "on" }))).rejects.toThrow("result=connection"); expect(m.save).not.toHaveBeenCalled();
    await expect(savePaymentIntegration(form({ enabled: "on" }))).rejects.toThrow("result=verified"); expect(m.save.mock.calls[0][0].update.value.checkedAt).toBeTruthy();
  });
  it("requires fiscal settings, payment mode and explicit external receipt confirmation", async () => {
    const cases: Record<string, string>[] = [{ vatType: "" }, { taxSystemCode: "" }, { card: "", sbp: "" }, { receiptMode: "external" }, { token: "sandbox.jwt.token" }];
    for (const extra of cases) await expect(savePaymentIntegration(form({ enabled: "on", ...extra }))).rejects.toThrow("result=incomplete");
    expect(m.check).not.toHaveBeenCalled(); expect(m.save).not.toHaveBeenCalled();
  });
  it("prevents merchant changes for unfinished payments while permitting token rotation in the same company", async () => {
    m.count.mockResolvedValue(1); await expect(savePaymentIntegration(form({ merchantId: "200000000001098" }))).rejects.toThrow("result=pending"); expect(m.save).not.toHaveBeenCalled();
    await expect(savePaymentIntegration(form({ token: "qa-only-new-bank-jwt-token", enabled: "on" }))).rejects.toThrow("result=verified"); expect(m.save).toHaveBeenCalledTimes(1);
  });
  it("rejects a stale form when another administrator has changed settings", async () => {
    m.config.mockResolvedValueOnce(config).mockResolvedValueOnce({ ...config, merchantId: "200000000001098" }); await expect(savePaymentIntegration(form())).rejects.toThrow("result=pending"); expect(m.save).not.toHaveBeenCalled();
  });
});
