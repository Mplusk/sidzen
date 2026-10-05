import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkTochka, getTochkaOperation, tochkaPaymentUrl, tochkaRequest, type TochkaOperation } from "./client";
import { getTochkaConfig, tochkaReady, TOCHKA_SETTING, type TochkaConfig } from "./config";
import { encryptSecret } from "@/lib/integration-secrets";
vi.mock("@/lib/prisma", () => ({ prisma: { siteSetting: { findUnique: async () => null } } }));
export const config: TochkaConfig = { enabled: true, token: "qa-only-synthetic-jwt-token", customerCode: "1234567ab", merchantId: "200000000001097", card: true, sbp: true, receiptMode: "provider", vatType: "none", taxSystemCode: "usn_income", externalReceiptsConfirmed: false, checkedAt: "2026-10-05T00:00:00.000Z" };
const operation: TochkaOperation = { operationId: "bank-operation", amount: "120.50", customerCode: config.customerCode, merchantId: config.merchantId, paymentLinkId: "payment-1", status: "CREATED", paymentLink: "https://merch.tochka.com/order/?uuid=qa-only" };
beforeEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("Tochka configuration and API", () => {
  it("is off by default and never uses a sandbox key in production", async () => {
    expect(tochkaReady(await getTochkaConfig())).toBe(false);
    expect(tochkaReady(config)).toBe(true);
    for (const change of [{ token: "sandbox.jwt.token" }, { checkedAt: undefined }, { card: false, sbp: false }, { taxSystemCode: "" as const }, { receiptMode: "external" as const, externalReceiptsConfirmed: false }]) expect(tochkaReady({ ...config, ...change })).toBe(false);
    expect(tochkaReady({ ...config, receiptMode: "external", externalReceiptsConfirmed: true })).toBe(true);
  });
  it("decrypts only purpose-bound stored credentials and saved disablement overrides env", async () => {
    vi.stubEnv("AUTH_SECRET", "qa-only"); vi.stubEnv("PAYMENT_PROVIDER", "tochka");
    const stored = { ...config, enabled: false, token: encryptSecret(config.token, TOCHKA_SETTING) };
    const database = { siteSetting: { findUnique: vi.fn().mockResolvedValue({ value: stored }) } };
    expect(await getTochkaConfig(database as never)).toEqual({ ...config, enabled: false });
    expect(stored.token).not.toContain(config.token);
  });
  it("checks only read methods, business company, active retailer, methods and cashbox", async () => {
    const bank = vi.fn().mockResolvedValueOnce(Response.json({ Data: { Customer: [{ customerCode: config.customerCode, customerType: "Business" }] } })).mockResolvedValueOnce(Response.json({ Data: { Retailer: [{ merchantId: config.merchantId, status: "REG", isActive: true, paymentModes: ["card", "sbp"], cashbox: "cashbox" }] } })).mockResolvedValueOnce(Response.json({ Data: { Operation: [] } }));
    vi.stubGlobal("fetch", bank); await checkTochka(config);
    expect(bank).toHaveBeenCalledTimes(3);
    for (const [url, options] of bank.mock.calls) { expect(url).toMatch(/^https:\/\/enter.tochka.com\/uapi\//); expect(options).toMatchObject({ method: "GET", cache: "no-store", redirect: "error", headers: { Authorization: `Bearer ${config.token}` } }); }
  });
  it("rejects a personal company and does not create a payment to test credentials", async () => {
    const bank = vi.fn().mockResolvedValue(Response.json({ Data: { Customer: [{ customerCode: config.customerCode, customerType: "Personal" }] } })); vi.stubGlobal("fetch", bank);
    await expect(checkTochka(config)).rejects.toThrow("tochka-customer"); expect(bank).toHaveBeenCalledTimes(1);
  });
  it("uses Operation[] from the real bank response, not Data.operationId", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ Data: { Operation: [operation] } })));
    expect(await getTochkaOperation(config, operation.operationId)).toEqual(operation);
  });
  it("does not follow redirects or leak bank error details", async () => {
    const bank = vi.fn().mockResolvedValue(new Response("private buyer data", { status: 403 })); vi.stubGlobal("fetch", bank);
    await expect(tochkaRequest(config, "acquiring/v1.0/payments")).rejects.toThrow("tochka-api-403");
    await expect(tochkaRequest({ token: "sandbox.jwt.token" }, "acquiring/v1.0/payments")).rejects.toThrow("tochka-token"); expect(bank).toHaveBeenCalledTimes(1);
  });
  it("only returns public HTTPS payment links for payable states", () => {
    expect(tochkaPaymentUrl(operation)).toBe(operation.paymentLink);
    expect(tochkaPaymentUrl({ ...operation, status: "APPROVED" })).toBeNull();
    for (const paymentLink of ["http://merch.tochka.com", "javascript:alert(1)", "https://127.0.0.1/", "https://localhost/", "https://user:pass@merch.tochka.com/"]) expect(() => tochkaPaymentUrl({ ...operation, paymentLink })).toThrow();
  });
});
