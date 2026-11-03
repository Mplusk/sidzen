import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("@/lib/payments", () => ({ refreshPayment: m.refresh }));
import { POST } from "./route";
const paymentId = "28646d50-000f-5000-a000-1fe4f81e5e88";
const refundId = "28646d50-000f-5000-a000-1fe4f81e5e89";
const request = (body: unknown) => new Request("https://shop.example/api/payments/yookassa/", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); m.refresh.mockResolvedValue(undefined); });
describe("YooKassa webhook boundary", () => {
  it("rechecks a claimed payment using its ID rather than trusting the notification amount or status", async () => {
    expect((await POST(request({ type: "notification", event: "payment.succeeded", object: { id: paymentId, amount: { value: "1.00" } } }))).status).toBe(200);
    expect(m.refresh).toHaveBeenCalledWith(paymentId);
  });
  it("rechecks the associated payment after a refund", async () => {
    expect((await POST(request({ type: "notification", event: "refund.succeeded", object: { id: refundId, payment_id: paymentId } }))).status).toBe(200);
    expect(m.refresh).toHaveBeenCalledWith(paymentId);
  });
  it("requests another notification when verification fails and bounds the request body", async () => {
    m.refresh.mockRejectedValue(new Error("unavailable"));
    expect((await POST(request({ type: "notification", event: "payment.succeeded", object: { id: paymentId } }))).status).toBe(503);
    expect((await POST(new Request("https://shop.example/", { method: "POST", body: "x".repeat(32769) }))).status).toBe(413);
  });
});
