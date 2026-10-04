import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ find: vi.fn(), contacts: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { privacyConsent: { findUnique: mocks.find } } }));
vi.mock("@/lib/settings", () => ({ getStoreContacts: mocks.contacts }));
import { consentDocument, operatorReady, privacySubject, verifyDeliveryConsent } from "./privacy";
import { CONSENT_VERSION } from "./privacy-documents";
afterEach(() => vi.unstubAllEnvs());
describe("personal-data consent", () => {
  beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("AUTH_SECRET", "test-only"); vi.stubEnv("PERSONAL_DATA_RF_STORAGE_CONFIRMED", "true"); mocks.contacts.mockResolvedValue({ legalName: "QA operator", legalAddress: "QA address", email: "operator@example.test", inn: "" }); });
  it("requires identified operator and valid contact email", async () => {
    expect(await operatorReady()).toBe(true);
    mocks.contacts.mockResolvedValue({ legalName: "", legalAddress: "", email: "" });
    expect(await operatorReady()).toBe(false); await expect(consentDocument("ozon")).rejects.toThrow("operator");
    mocks.contacts.mockResolvedValue({ legalName: "Name", legalAddress: "Address", email: "bad" }); expect(await operatorReady()).toBe(false);
  });
  it("does not treat seller details alone as proof of Russian database location", async () => {
    vi.stubEnv("PERSONAL_DATA_RF_STORAGE_CONFIRMED", "false"); expect(await operatorReady()).toBe(false);
    vi.stubEnv("PERSONAL_DATA_RF_STORAGE_CONFIRMED", ""); expect(await operatorReady()).toBe(false);
  });
  it("snapshots separate versioned purpose without copying recipient phone", async () => {
    const document = await consentDocument("ozon");
    expect(document).toMatchObject({ purpose: "ozon", version: CONSENT_VERSION, operator: { name: "QA operator" } });
    expect(privacySubject("cart", "+79991234567")).not.toContain("7999");
    expect(privacySubject("other", "+79991234567")).not.toBe(privacySubject("cart", "+79991234567"));
  });
  it("rejects missing, revoked, expired, wrong-purpose, old or other-cart permissions", async () => {
    const valid = { purpose: "ozon", version: CONSENT_VERSION, revokedAt: null, expiresAt: new Date(Date.now() + 60000), subjectHash: privacySubject("cart", "+79991234567") };
    mocks.find.mockResolvedValue(valid); await expect(verifyDeliveryConsent("id", "cart", "+79991234567")).resolves.toBeUndefined();
    for (const invalid of [null, { ...valid, revokedAt: new Date() }, { ...valid, expiresAt: new Date(0) }, { ...valid, purpose: "account" }, { ...valid, version: "old" }, { ...valid, subjectHash: "wrong" }]) {
      mocks.find.mockResolvedValue(invalid); await expect(verifyDeliveryConsent("id", "cart", "+79991234567")).rejects.toThrow("consent");
    }
  });
});
