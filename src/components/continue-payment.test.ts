import { describe, expect, it } from "vitest";

import { canContinuePayment } from "@/lib/payment-availability";

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
});
