import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ permission: vi.fn(), rate: vi.fn(), config: vi.fn(), verify: vi.fn(), save: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePermission: m.permission }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: m.rate }));
vi.mock("@/lib/category-ai/config", async original => ({ ...await original<object>(), getCategoryAiConfig: m.config }));
vi.mock("@/lib/category-ai/client", () => ({ verifyCategoryAi: m.verify }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: (fn: (tx: unknown) => unknown) => fn({ $executeRaw: vi.fn(), siteSetting: { upsert: m.save }, auditLog: { create: m.audit } }) } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
import { saveCategoryAiConfig } from "./category-ai";
import { decryptSecret } from "@/lib/integration-secrets";
const config = { enabled: false, apiKey: "sk-fixture-deepseek-key", model: "deepseek-flash", allowCreate: true, revision: "v1", checkedAt: null };
function form(extra: Record<string, string> = {}) { const result = new FormData(); for (const [key, value] of Object.entries({ apiKey: "", model: "deepseek-flash", allowCreate: "on", revision: "v1", ...extra })) result.set(key, value); return result; }
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("AUTH_SECRET", "qa-only"); m.permission.mockResolvedValue({ id: "admin" }); m.rate.mockReturnValue({ allowed: true }); m.config.mockResolvedValue(config); });
describe("DeepSeek administrator settings", () => {
  it("requires permission and rate limiting before loading secrets", async () => {
    m.permission.mockRejectedValueOnce(new Error("forbidden")); await expect(saveCategoryAiConfig(form())).rejects.toThrow("forbidden"); expect(m.config).not.toHaveBeenCalled();
    m.rate.mockReturnValue({ allowed: false }); await expect(saveCategoryAiConfig(form())).rejects.toThrow("ai-rate"); expect(m.config).not.toHaveBeenCalled();
  });
  it("encrypts the key, preserves blank input and never audits it", async () => {
    await expect(saveCategoryAiConfig(form())).rejects.toThrow("ai-saved");
    expect(m.save.mock.calls[0][0].update.group).toBe("integrations");
    const stored = m.save.mock.calls[0][0].update.value;
    expect(stored.apiKey).not.toBe(config.apiKey); expect(decryptSecret(stored.apiKey, "catalog.category-ai.deepseek")).toBe(config.apiKey);
    expect(JSON.stringify(m.audit.mock.calls)).not.toContain(config.apiKey); expect(m.verify).not.toHaveBeenCalled();
  });
  it("verifies before enabling and never saves a rejected key", async () => {
    m.verify.mockRejectedValueOnce(new Error("private provider contents")); await expect(saveCategoryAiConfig(form({ enabled: "on" }))).rejects.toThrow("ai-connection"); expect(m.save).not.toHaveBeenCalled();
    await expect(saveCategoryAiConfig(form({ enabled: "on" }))).rejects.toThrow("ai-saved"); expect(m.save.mock.calls[0][0].update.value.checkedAt).toBeTruthy();
  });
  it("rejects stale revisions and invalid input; clearing a key disables categorization", async () => {
    m.config.mockResolvedValueOnce(config).mockResolvedValueOnce({ ...config, revision: "v2" });
    await expect(saveCategoryAiConfig(form())).rejects.toThrow("ai-changed"); expect(m.save).not.toHaveBeenCalled();
    await expect(saveCategoryAiConfig(form({ apiKey: "Bearer key\n" }))).rejects.toThrow("ai-invalid");
    await expect(saveCategoryAiConfig(form({ model: "arbitrary-url" }))).rejects.toThrow("ai-invalid");
    await expect(saveCategoryAiConfig(form({ enabled: "on", clearKey: "on" }))).rejects.toThrow("ai-incomplete");
    await expect(saveCategoryAiConfig(form({ clearKey: "on" }))).rejects.toThrow("ai-saved");
    expect(m.save.mock.calls[0][0].update.value.apiKey).toBe("");
  });
});
