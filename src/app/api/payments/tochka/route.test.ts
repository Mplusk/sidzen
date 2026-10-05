import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ verify: vi.fn(), find: vi.fn(), config: vi.fn(), get: vi.fn(), apply: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { payment: { findFirst: m.find } } }));
vi.mock("@/lib/tochka/webhook", async importOriginal => ({ ...await importOriginal<object>(), verifyTochkaWebhook: m.verify }));
vi.mock("@/lib/tochka/config", () => ({ getTochkaConfig: m.config }));
vi.mock("@/lib/tochka/client", () => ({ getTochkaOperation: m.get }));
vi.mock("@/lib/payments", () => ({ applyTochkaPayment: m.apply }));
import { POST } from "./route";
const claims = { webhookType: "acquiringInternetPayment", operationId: "bank-op", paymentLinkId: "payment-1", customerCode: "1234567ab", merchantId: "200000000001097", amount: 1, status: "APPROVED" };
const request = () => new Request("https://shop.example/api/payments/tochka/", { method: "POST", body: "signed-bank-fixture", headers: { "Content-Type": "text/plain" } });
beforeEach(() => { vi.resetAllMocks(); m.verify.mockResolvedValue(claims); m.find.mockResolvedValue({ id: "payment-1" }); m.config.mockResolvedValue({ customerCode: claims.customerCode, merchantId: claims.merchantId }); m.get.mockResolvedValue({ amount: 1490, status: "CREATED" }); });
describe("Tochka webhook boundary", () => {
  it("does not touch the database or bank on a forged notification", async () => { m.verify.mockRejectedValue(new Error("webhook-signature")); expect((await POST(request())).status).toBe(401); expect(m.find).not.toHaveBeenCalled(); expect(m.get).not.toHaveBeenCalled(); });
  it("acknowledges signed test and unrelated payments without bank requests", async () => { m.verify.mockResolvedValueOnce({ webhookType: "acquiringInternetPayment" }); expect((await POST(request())).status).toBe(200); m.find.mockResolvedValue(null); expect((await POST(request())).status).toBe(200); expect(m.get).not.toHaveBeenCalled(); });
  it("ignores claimed amount and paid status and applies only a fresh authenticated GET", async () => { expect((await POST(request())).status).toBe(200); expect(m.get).toHaveBeenCalledWith(expect.anything(), claims.operationId); expect(m.apply).toHaveBeenCalledWith("payment-1", { amount: 1490, status: "CREATED" }); });
  it("rejects company mismatch and asks the bank to retry a failed verification", async () => { m.config.mockResolvedValueOnce({ customerCode: "other", merchantId: claims.merchantId }); expect((await POST(request())).status).toBe(400); expect(m.get).not.toHaveBeenCalled(); m.get.mockRejectedValue(new Error("bank-unavailable")); expect((await POST(request())).status).toBe(503); expect(m.apply).not.toHaveBeenCalled(); });
  it("rejects oversized requests before key verification", async () => { const response = await POST(new Request(request(), { body: "x".repeat(32769) })); expect(response.status).toBe(413); expect(m.verify).not.toHaveBeenCalled(); });
});
