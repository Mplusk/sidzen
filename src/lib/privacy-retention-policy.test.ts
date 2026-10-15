import { expect, it } from "vitest";
import { afterDays, erasureBlocked, fiscalRetentionEnd, inactiveAccountCutoff, orderRetentionEnd, type RetentionOrder } from "./privacy-retention-policy";
const closed: RetentionOrder = { status: "CANCELED", deletedAt: null, createdAt: new Date("2026-01-01Z"), updatedAt: new Date("2026-10-10Z"), privacyClosedAt: new Date("2026-01-31Z"), retentionHoldUntil: null, purchaseConfirmedAt: null, payment: null, fiscalReceipts: [], shipment: null };
it("cleans within 30 days of closure with a sweep margin, not a later technical refresh", () => {
  expect(orderRetentionEnd(closed)).toEqual(new Date("2026-03-01Z"));
  expect(orderRetentionEnd(closed).getTime()).toBeLessThan(afterDays(new Date("2026-01-31Z"), 30).getTime());
});
it("keeps fiscal evidence through five complete following calendar years and honors later receipts", () => {
  expect(fiscalRetentionEnd(new Date("2026-12-31Z"))).toEqual(new Date("2031-12-31T21:00:00Z"));
  expect(fiscalRetentionEnd(new Date("2026-12-31T22:00:00Z"))).toEqual(new Date("2032-12-31T21:00:00Z"));
  expect(orderRetentionEnd({ ...closed, purchaseConfirmedAt: new Date("2026-02-01Z"), fiscalReceipts: [{ status: "PROCESSED", createdAt: new Date("2027-01-05Z"), processedAt: new Date("2027-01-06Z") }] })).toEqual(new Date("2032-12-31T21:00:00Z"));
});
it("does not erase active orders, open financial cases, carrier cancellation or legal holds", () => {
  const now = new Date("2026-10-15Z");
  expect(erasureBlocked(closed, now)).toBe(false);
  for (const patch of [
    { status: "NEW" }, { retentionHoldUntil: new Date("2027-01-01Z") },
    { payment: { status: "PAID", refundReviewRequired: true, paidAt: now } },
    { fiscalReceipts: [{ status: "MANUAL_REVIEW", createdAt: now, processedAt: null }] },
    { shipment: { ozonJob: { status: "CREATED", lockedUntil: null, cancelRequestedAt: now } } },
  ]) expect(erasureBlocked({ ...closed, ...patch }, now)).toBe(true);
  expect(erasureBlocked({ ...closed, shipment: { ozonJob: { status: "CANCELED", lockedUntil: null, cancelRequestedAt: now } } }, now)).toBe(false);
  expect(inactiveAccountCutoff(now)).toEqual(new Date("2024-10-15Z"));
});
