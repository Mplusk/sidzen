import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptSecret, decryptSecret } from "./integration-secrets";
const db = vi.hoisted(() => ({ find: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { siteSetting: { findUnique: db.find } } }));
import { checkYookassa, deliveryConfigSchema, getPaymentConfig, PAYMENT_SETTING } from "./integrations";

beforeEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); vi.stubEnv("AUTH_SECRET", "test-only-encryption-secret"); db.find.mockResolvedValue(null); });
describe("integration secrets", () => {
  it("encrypts with fresh nonces and authenticates purpose and key", () => {
    const encrypted = encryptSecret("private-key", PAYMENT_SETTING);
    expect(encrypted).not.toContain("private-key");
    expect(encryptSecret("private-key", PAYMENT_SETTING)).not.toBe(encrypted);
    expect(decryptSecret(encrypted, PAYMENT_SETTING)).toBe("private-key");
    expect(() => decryptSecret(encrypted, "another-provider")).toThrow();
    vi.stubEnv("AUTH_SECRET", "different-key");
    expect(() => decryptSecret(encrypted, PAYMENT_SETTING)).toThrow();
  });
  it("saved disabled configuration overrides enabled environment", async () => {
    vi.stubEnv("PAYMENT_PROVIDER", "yookassa");
    db.find.mockResolvedValue({ value: { enabled: false, shopId: "123", secret: encryptSecret("secret", PAYMENT_SETTING), receiptMode: "provider", vatCode: "1", taxSystemCode: "" } });
    expect(await getPaymentConfig()).toMatchObject({ enabled: false, secret: "secret", shopId: "123" });
  });
  it("only verifies matching live merchants via a fixed read-only endpoint", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ account_id: "123", test: false, status: "enabled" }) });
    vi.stubGlobal("fetch", fetcher);
    await checkYookassa({ shopId: "123", secret: "secret" });
    expect(fetcher.mock.calls[0][0]).toBe("https://api.yookassa.ru/v3/me");
    expect(fetcher.mock.calls[0][1].body).toBeUndefined();
    await expect(checkYookassa({ shopId: "other", secret: "secret" })).rejects.toThrow();
    fetcher.mockResolvedValue({ ok: true, json: async () => ({ account_id: "123", test: true }) });
    await expect(checkYookassa({ shopId: "123", secret: "secret" })).rejects.toThrow();
  });
  it("rejects invalid delivery rates", () => {
    const input = { name: "СДЭК", description: "", sortOrder: 0, active: true };
    for (const basePrice of [-1, 0.001, Infinity, "bad"]) expect(deliveryConfigSchema.safeParse({ ...input, basePrice }).success).toBe(false);
    expect(deliveryConfigSchema.parse({ ...input, basePrice: "390.50" }).basePrice).toBe(390.5);
  });
});
