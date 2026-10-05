import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cloudConfigured, cloudReady, cloudSchema, validInn } from "./config";
import { cents, createFiscalPayload, derivedFiscalPayload, receiptMatches } from "./payload";
import { checkCloud, cloudRequest, safeReceiptUrl } from "./client";
import { readCloudBody, verifyCloudHmac } from "./webhook";

const config = cloudSchema.parse({ enabled: true, publicId: "qa-terminal", apiSecret: "qa-secret", inn: "7707083893", deviceNumber: "123456789", fiscalNumber: "9999078900005430", productionConfirmed: true, operatorReviewed: true, taxConfirmed: true, checkedAt: new Date().toISOString() });
const order = { total: "150", subtotal: "150", discount: "0", deliveryPrice: "0", currency: "RUB", customerEmail: "fixture@example.test", customerName: "Must not transmit", customerPhone: "+79990000000", shippingAddress: "Private address", items: [{ productName: "Салфетница", quantity: 3, unitPrice: "50", totalPrice: "150" }] };
const original = createFiscalPayload(order, config.inn, "receipt-1");
afterEach(() => vi.unstubAllGlobals());
describe("CloudKassir AUSN income / no VAT", () => {
  it("fails closed until all checks and operator confirmations are present", () => {
    expect(cloudReady(cloudSchema.parse({}))).toBe(false); expect(cloudReady(config)).toBe(true);
    for (const field of ["publicId", "apiSecret", "inn", "deviceNumber", "fiscalNumber", "checkedAt"] as const) expect(cloudReady({ ...config, [field]: "" })).toBe(false);
    for (const field of ["productionConfirmed", "operatorReviewed", "taxConfirmed"] as const) expect(cloudReady({ ...config, [field]: false })).toBe(false);
    expect(cloudReady({ ...config, enabled: false })).toBe(false); expect(cloudConfigured({ ...config, enabled: false })).toBe(true);
    expect(cloudSchema.safeParse({ taxRegime: "osn" }).success).toBe(false); expect(cloudSchema.safeParse({ vat: "0" }).success).toBe(false);
  });
  it("validates INN checksum, not just length", () => {
    expect(validInn("7707083893")).toBe(true); expect(validInn("500100732259")).toBe(true);
    for (const inn of ["", "0000000000", "000000000000", "7707083894", "500100732258", "abcdefghij"]) expect(validInn(inn)).toBe(false);
  });
  it("creates email-only full prepayment, no VAT (null, NOT zero), no free delivery line", () => {
    expect(original.CustomerReceipt).toMatchObject({ TaxationSystem: 1, Email: order.customerEmail, IsInternetPayment: true, CalculationPlace: "https://3dprinta.shop", Amounts: { Electronic: 150, AdvancePayment: 0 }, Items: [{ Label: "Салфетница", Quantity: 3, Price: 50, Amount: 150, Vat: null, Method: 1, Object: 1 }] });
    expect(original.CustomerReceipt.Items).toHaveLength(1);
    const json = JSON.stringify(original); for (const privateValue of [order.customerName, order.customerPhone, order.shippingAddress]) expect(json).not.toContain(privateValue);
  });
  it("settles the advance without charging the buyer a second time", () => {
    const body = derivedFiscalPayload(original, "SETTLEMENT", "receipt-2", false);
    expect(body.CustomerReceipt.Amounts).toEqual({ Electronic: 0, AdvancePayment: 150, Credit: 0, Provision: 0 });
    expect(body.CustomerReceipt.Items[0].Method).toBe(4); expect(body.Type).toBe("Income"); expect(original.CustomerReceipt.Items[0].Method).toBe(1);
  });
  it("uses IncomeReturn and the actual prior calculation method for full refunds", () => {
    for (const delivered of [true, false]) {
      const body = derivedFiscalPayload(original, "REFUND", "receipt-3", delivered);
      expect(body.Type).toBe("IncomeReturn"); expect(body.CustomerReceipt.Items[0].Method).toBe(delivered ? 4 : 1); expect(body.CustomerReceipt.Amounts.Electronic).toBe(150);
    }
  });
  it("allocates discounts exactly in kopecks including split quantities", () => {
    for (let discount = 1; discount < 70; discount++) {
      const body = createFiscalPayload({ ...order, subtotal: 110.01, total: (11001 - discount) / 100, discount: discount / 100, items: [{ productName: "А", quantity: 3, unitPrice: 20, totalPrice: 60 }, { productName: "Б", quantity: 3, unitPrice: 16.67, totalPrice: 50.01 }] }, config.inn, "qa");
      expect(body.CustomerReceipt.Items.reduce((sum, item) => sum + cents(item.Amount), 0)).toBe(11001 - discount);
      for (const item of body.CustomerReceipt.Items) expect(cents(item.Price) * item.Quantity).toBe(cents(item.Amount));
    }
  });
  it("adds paid delivery as a service, not goods", () => {
    const body = createFiscalPayload({ ...order, total: 200, deliveryPrice: 50 }, config.inn, "qa");
    expect(body.CustomerReceipt.Items[1]).toMatchObject({ Object: 4, Price: 50, Label: "Доставка", Vat: null });
  });
  it("rejects inconsistent totals, fractional pieces, invalid currency and over 100 receipt lines", () => {
    for (const changes of [{ total: 1 }, { subtotal: 1 }, { discount: 150 }, { currency: "USD" }, { customerEmail: "invalid" }, { items: [{ ...order.items[0], quantity: 1.5 }] }, { items: [{ ...order.items[0], totalPrice: 149 }] }]) expect(() => createFiscalPayload({ ...order, ...changes }, config.inn, "qa")).toThrow();
    expect(() => createFiscalPayload({ ...order, items: Array.from({ length: 101 }, () => ({ ...order.items[0], quantity: 1, unitPrice: 1, totalPrice: 1 })), subtotal: 101, total: 101 }, config.inn, "qa")).toThrow();
    for (const value of ["-1", "1.001", "NaN", "9007199254740991"]) expect(() => cents(value)).toThrow();
  });
  it("compares fiscal composition with reordered fields / camelCase / provider extras", () => {
    expect(receiptMatches({ ...original.CustomerReceipt, Email: null, Items: original.CustomerReceipt.Items.map(row => ({ ...row, Department: null, AgentSign: null })) }, original.CustomerReceipt)).toBe(true);
    expect(receiptMatches(JSON.parse(JSON.stringify(original.CustomerReceipt).replace(/"([A-Z])([^"\n]*)":/g, (_, first, rest) => `"${first.toLowerCase()}${rest}":`)), original.CustomerReceipt)).toBe(true);
    for (const changes of [{ TaxationSystem: 0 }, { Email: "other@example.test" }, { Amounts: { Electronic: 1 } }, { Items: [{ ...original.CustomerReceipt.Items[0], Vat: 0 }] }, { Items: [{ ...original.CustomerReceipt.Items[0], Method: 4 }] }]) expect(receiptMatches({ ...original.CustomerReceipt, ...changes }, original.CustomerReceipt)).toBe(false);
  });
  it("accepts only the exact signed raw body, rejects decoded/reordered/forged callbacks", () => {
    const body = "InvoiceId=one&Receipt=%7B%22name%22%3A%22%D1%82%D0%B5%D1%81%D1%82%22%7D";
    const signature = createHmac("sha256", "qa-secret").update(body).digest("base64");
    expect(verifyCloudHmac(body, signature, "qa-secret")).toBe(true);
    for (const changed of [body + "&Amount=1", decodeURIComponent(body), body.toLowerCase()]) expect(verifyCloudHmac(changed, signature, "qa-secret")).toBe(false);
    expect(verifyCloudHmac(body, signature, "wrong")).toBe(false); expect(verifyCloudHmac(body, null, "qa-secret")).toBe(false); expect(verifyCloudHmac(body, "x", "qa-secret")).toBe(false);
  });
  it("bounds notification bodies and provider responses", async () => {
    await expect(readCloudBody(new Request("https://3dprinta.shop/", { method: "POST", body: "x".repeat(65537) }))).rejects.toThrow("size");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x".repeat(131073)))); await expect(cloudRequest(config, "test")).rejects.toThrow("cloud-response-size");
  });
  it("checks authentication and a live registered matching cashbox without generating any receipts", async () => {
    const state = { Inn: config.inn, DeviceNumber: config.deviceNumber, FiscalNumber: config.fiscalNumber, Status: 1, Fiscal: true, IsBso: false, FiscalDateEnd: "2099-01-01T00:00:00", CalculationPlace: "3dprinta.shop" };
    const requests: string[] = [];
    const fetcher = vi.fn(async (url: string, init: RequestInit) => { requests.push(url); expect(init.redirect).toBe("error"); expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from(`${config.publicId}:${config.apiSecret}`).toString("base64")}`); return Response.json({ Success: true, Model: url.endsWith("/test") ? undefined : state }); });
    vi.stubGlobal("fetch", fetcher); await checkCloud(config); expect(requests.map(url => new URL(url).pathname)).toEqual(["/test", "/kkt/state/get"]);
    state.Status = 2; await expect(checkCloud(config)).rejects.toThrow("cloud-cashbox"); state.Status = 1; state.Inn = "wrong"; await expect(checkCloud(config)).rejects.toThrow("cloud-cashbox");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ Success: false, Message: "secret PII" }))); await expect(cloudRequest(config, "test")).rejects.toThrow("cloud-rejected");
  });
  it("never links to arbitrary URLs supplied in callbacks", () => {
    expect(safeReceiptUrl("https://receipts.ru/qa-only")).toBe("https://receipts.ru/qa-only");
    for (const url of ["javascript:alert(1)", "https://receipts.ru.evil.test/x", "https://evil.test/x", "http://receipts.ru/x", "https://user:pass@receipts.ru/x", "https://receipts.ru:999/x"]) expect(safeReceiptUrl(url)).toBeNull();
  });
});
