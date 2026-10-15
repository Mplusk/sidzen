// Store policy, not universal statutory periods. Fiscal/contract evidence has a
// separate minimum; active obligations and explicit holds always take priority.
export const RETENTION = { closedApplicationDays: 30, inactiveAccountMonths: 24, backupDays: 14, erasureEvidenceYears: 3, fiscalYears: 5 } as const;
export const terminalOrderStatuses = ["DELIVERED", "CANCELED", "REFUNDED"] as const;
export function afterDays(date: Date, days: number) { return new Date(date.getTime() + days * 86400000); }
export function fiscalRetentionEnd(date: Date) {
  // End of the fifth calendar year following the year of the last obligation.
  const year = Number(new Intl.DateTimeFormat("en", { timeZone: "Europe/Moscow", year: "numeric" }).format(date));
  return new Date(Date.UTC(year + RETENTION.fiscalYears + 1, 0, 1) - 3 * 3600000);
}
export function inactiveAccountCutoff(now: Date) {
  const result = new Date(now); result.setUTCMonth(result.getUTCMonth() - RETENTION.inactiveAccountMonths); return result;
}
export type RetentionOrder = {
  status: string; deletedAt: Date | null; createdAt: Date; updatedAt: Date;
  privacyClosedAt: Date | null; retentionHoldUntil: Date | null; purchaseConfirmedAt: Date | null;
  payment: { status: string; refundReviewRequired: boolean; paidAt: Date | null } | null;
  fiscalReceipts: Array<{ status: string; createdAt: Date; processedAt: Date | null }>;
  shipment: { ozonJob: { status: string; lockedUntil: Date | null; cancelRequestedAt: Date | null } | null } | null;
};
export function erasureBlocked(order: RetentionOrder, now: Date) {
  if (order.retentionHoldUntil && order.retentionHoldUntil > now) return true;
  if (!order.deletedAt && !terminalOrderStatuses.some(status => status === order.status)) return true;
  if (!terminalOrderStatuses.some(status => status === order.status) && ["PAID", "QUEUED", "PRINTING", "POST_PROCESSING", "PACKED", "SHIPPED"].includes(order.status)) return true;
  if (order.payment && (["PENDING", "AUTHORIZED"].includes(order.payment.status) || order.payment.refundReviewRequired)) return true;
  if (order.fiscalReceipts.some(receipt => !["PROCESSED", "CANCELED"].includes(receipt.status))) return true;
  const job = order.shipment?.ozonJob;
  if (job && ((job.lockedUntil && job.lockedUntil > now) || ["PENDING", "RUNNING"].includes(job.status) || (job.cancelRequestedAt && job.status !== "CANCELED"))) return true;
  return false;
}
export function orderRetentionEnd(order: RetentionOrder) {
  const closed = order.privacyClosedAt ?? order.deletedAt ?? order.updatedAt;
  const financial = hasFinancialEvidence(order);
  // One-day sweep margin keeps hourly cleanup inside the published 30-day max.
  if (!financial) return afterDays(closed, RETENTION.closedApplicationDays - 1);
  const events = [closed, order.purchaseConfirmedAt, order.payment?.paidAt, ...order.fiscalReceipts.map(receipt => receipt.processedAt ?? receipt.createdAt)].filter((date): date is Date => Boolean(date));
  return fiscalRetentionEnd(new Date(Math.max(...events.map(date => date.getTime()))));
}
export function hasFinancialEvidence(order: RetentionOrder) {
  return Boolean(["DELIVERED", "REFUNDED"].includes(order.status) || order.purchaseConfirmedAt || order.fiscalReceipts.length || (order.payment && ["PAID", "REFUNDED"].includes(order.payment.status)));
}
