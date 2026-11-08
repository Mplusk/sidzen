import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ permission: vi.fn(), rate: vi.fn(), config: vi.fn(), save: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePermission: m.permission }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: m.rate }));
vi.mock("@/lib/yandex-maps/config", () => ({ YANDEX_MAPS_SETTING: "maps.yandex", getYandexMapsConfig: m.config }));
vi.mock("@/lib/prisma", () => ({ prisma: { $transaction: (fn: (tx: unknown) => unknown) => fn({ $executeRaw: vi.fn(), siteSetting: { upsert: m.save }, auditLog: { create: m.audit } }) } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
import { saveYandexMapsSettings } from "./yandex-maps";
import { decryptSecret } from "@/lib/integration-secrets";

function form(extra: Record<string, string> = {}) {
  const data = new FormData();
  for (const [key, value] of Object.entries({ mapsApiKey: "", revision: "v1", ...extra })) data.set(key, value);
  return data;
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("AUTH_SECRET", "test-only");
  m.permission.mockResolvedValue({ id: "admin" }); m.rate.mockReturnValue({ allowed: true });
  m.config.mockResolvedValue({ apiKey: "fixture-key-12345678", revision: "v1" });
});
afterEach(() => vi.unstubAllEnvs());
describe("Yandex Maps administrator settings", () => {
  it("requires administrator permission and rate limits changes", async () => {
    m.permission.mockRejectedValueOnce(new Error("forbidden"));
    await expect(saveYandexMapsSettings(form())).rejects.toThrow("forbidden"); expect(m.config).not.toHaveBeenCalled();
    m.rate.mockReturnValue({ allowed: false });
    await expect(saveYandexMapsSettings(form())).rejects.toThrow("maps-rate"); expect(m.config).not.toHaveBeenCalled();
  });
  it("encrypts saved keys and never puts them in the audit log", async () => {
    await expect(saveYandexMapsSettings(form())).rejects.toThrow("maps-saved");
    const stored = m.save.mock.calls[0][0].update.value.apiKey;
    expect(stored).not.toBe("fixture-key-12345678");
    expect(decryptSecret(stored, "maps.yandex")).toBe("fixture-key-12345678");
    expect(JSON.stringify(m.audit.mock.calls)).not.toContain("fixture-key-12345678");
  });
  it("rejects invalid and stale changes and supports clearing the key", async () => {
    await expect(saveYandexMapsSettings(form({ mapsApiKey: "bad url!" }))).rejects.toThrow("maps-invalid");
    m.config.mockResolvedValueOnce({ apiKey: "", revision: "v1" }).mockResolvedValueOnce({ apiKey: "", revision: "v2" });
    await expect(saveYandexMapsSettings(form())).rejects.toThrow("maps-changed");
    expect(m.save).not.toHaveBeenCalled();
    await expect(saveYandexMapsSettings(form({ clearKey: "on" }))).rejects.toThrow("maps-saved");
    expect(m.save.mock.calls[0][0].update.value.apiKey).toBe("");
  });
});
