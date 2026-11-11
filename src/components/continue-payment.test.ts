// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { canContinuePayment } from "@/lib/payment-availability";
const payment = vi.hoisted(() => vi.fn());
vi.mock("@/app/actions/yookassa-payment", () => ({ continueYooKassaPayment: payment }));
vi.mock("@/components/stock-hold-notice", () => ({ StockHoldNotice: () => null }));
import { ContinuePayment } from "./continue-payment";

const now = new Date("2030-01-01T12:00:00Z");
const order = { number: "3DP-300101-12345678", status: "AWAITING_PAYMENT", deletedAt: null, reservationExpiredAt: null, reservationExpiresAt: new Date(now.getTime() + 1), payment: { provider: "yookassa-online", status: "PENDING", payload: null } };

describe("returning to payment", () => {
  it("offers payment before the deadline", () => expect(canContinuePayment(order, now)).toBe(true));
  it.each([
    { ...order, reservationExpiresAt: now },
    { ...order, reservationExpiredAt: now },
    { ...order, status: "CANCELED" },
    { ...order, payment: { ...order.payment, status: "PAID" } },
    { ...order, payment: { ...order.payment, payload: { reconciliationRequired: true } } },
  ])("hides payment when the order is no longer eligible", value => expect(canContinuePayment(value, now)).toBe(false));
  it("submits the correct order from the compact action", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    payment.mockResolvedValue(undefined);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const pending = { ...order, reservationExpiresAt: new Date(Date.now() + 60_000) };
    try {
      await act(async () => root.render(createElement(ContinuePayment, { order: pending })));
      const form = container.querySelector("form")!;
      expect(form.querySelector<HTMLInputElement>('input[name="number"]')?.value).toBe(order.number);
      expect(form.querySelector("button")?.getAttribute("aria-label")).toContain(order.number);
      await act(async () => form.requestSubmit());
      expect(payment).toHaveBeenCalledOnce();
      expect(payment.mock.calls[0][0].get("number")).toBe(order.number);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
      payment.mockReset();
    }
  });
});
