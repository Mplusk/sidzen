export type PaymentOrder = {
  number: string;
  status: string;
  deletedAt: Date | null;
  reservationExpiresAt: Date | null;
  reservationExpiredAt: Date | null;
  payment: { provider: string; status: string; payload: unknown } | null;
};

/** Visibility is advisory; the payment action verifies ownership and expiry. */
export function canContinuePayment(order: PaymentOrder, now = new Date()) {
  const payload = order.payment?.payload;
  const needsReview = Boolean(payload && typeof payload === "object" && !Array.isArray(payload) && "reconciliationRequired" in payload && payload.reconciliationRequired === true);
  return !order.deletedAt && !order.reservationExpiredAt && !needsReview &&
    ["NEW", "APPROVED", "AWAITING_PAYMENT"].includes(order.status) &&
    order.payment?.provider === "yookassa-online" && order.payment.status === "PENDING" &&
    (!order.reservationExpiresAt || order.reservationExpiresAt > now);
}
