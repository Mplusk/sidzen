import { describe, expect, it } from "vitest";
import { estimatedDelivery, formatDeliveryDate, validDeliveryDate } from "./estimated-date";

const now = new Date("2030-01-05T09:00:00Z");
function ozon() {
  return { payload: { estimatedDays: 3 }, deliveredAt: null, cdekJob: null, ozonJob: { status: "CREATED", cancelRequestedAt: null, request: { postings: [{ request_id: 1, cutoff_at: "2030-01-04T00:00:00Z" }] }, response: { postings: [{ request_id: 1, posting_number: "p1", estimated_delivery_days: 3 }], statuses: [{ posting_number: "p1", status: "on_way" }] } } };
}
describe("estimated delivery date", () => {
  it("uses the planned handover and carrier duration without pretending it is live tracking", () => {
    expect(estimatedDelivery(ozon(), "PAID", now)).toEqual({ kind: "date", date: "2030-01-07", source: "plan" });
    expect(formatDeliveryDate("2030-01-07")).toBe("7 января 2030 г.");
  });
  it("uses the last arrival among complete parcels and respects Moscow calendar days", () => {
    const shipment = ozon();
    shipment.ozonJob.request.postings = [{ request_id: 1, cutoff_at: "2030-01-04T00:00:00Z" }, { request_id: 2, cutoff_at: "2030-01-04T23:30:00Z" }];
    shipment.ozonJob.response.postings = [{ request_id: 1, posting_number: "p1", estimated_delivery_days: 1 }, { request_id: 2, posting_number: "p2", estimated_delivery_days: 3 }];
    shipment.ozonJob.response.statuses = [{ posting_number: "p1", status: "on_way" }, { posting_number: "p2", status: "on_way" }];
    expect(estimatedDelivery(shipment, "PAID", now)).toEqual({ kind: "date", date: "2030-01-08", source: "plan" });
  });
  it("does not turn an overdue plan, an unshipped parcel or a partial order into a fresh date", () => {
    const shipment = ozon();
    expect(estimatedDelivery(shipment, "PAID", new Date("2030-01-09T00:00:00Z"))).toEqual({ kind: "pending" });
    shipment.ozonJob.response.statuses[0].status = "created";
    expect(estimatedDelivery(shipment, "PAID", now)).toEqual({ kind: "pending" });
    shipment.ozonJob.status = "REVIEW"; shipment.ozonJob.response.statuses[0].status = "in_delivery_point";
    expect(estimatedDelivery(shipment, "PAID", now)).toEqual({ kind: "pending" });
  });
  it("prefers a date entered by the store, but stops showing it after it passes", () => {
    const shipment = ozon();
    const manual = { ...shipment, payload: { ...shipment.payload, deliveryEstimateDate: "2030-01-09" } };
    expect(estimatedDelivery(manual, "PAID", now)).toEqual({ kind: "date", date: "2030-01-09", source: "manual" });
    expect(estimatedDelivery(manual, "PAID", new Date("2030-01-10T00:00:00Z"))).toEqual({ kind: "pending" });
  });
  it("does not mark an order as ready when parcel identifiers are duplicated", () => {
    const shipment = ozon();
    shipment.ozonJob.request.postings = [{ request_id: 1, cutoff_at: "2030-01-04T00:00:00Z" }, { request_id: 1, cutoff_at: "2030-01-04T00:00:00Z" }];
    shipment.ozonJob.response.postings = [{ request_id: 1, posting_number: "p1", estimated_delivery_days: 3 }, { request_id: 2, posting_number: "p2", estimated_delivery_days: 3 }];
    shipment.ozonJob.response.statuses = [{ posting_number: "p1", status: "in_delivery_point" }, { posting_number: "p2", status: "in_delivery_point" }];
    expect(estimatedDelivery(shipment, "PAID", now)).toEqual({ kind: "pending" });
  });
  it("does not invent a CDEK date without a confirmed handover or a manual estimate", () => {
    const shipment = { payload: { daysMin: 2, daysMax: 4 }, deliveredAt: null, ozonJob: null, cdekJob: { status: "CREATED", deliveryStatus: "IN_TRANSIT", cancelRequestedAt: null } };
    expect(estimatedDelivery(shipment, "SHIPPED", now)).toEqual({ kind: "pending" });
    expect(estimatedDelivery({ ...shipment, payload: { ...shipment.payload, deliveryEstimateDate: "2030-01-10" } }, "SHIPPED", now)).toEqual({ kind: "date", date: "2030-01-10", source: "manual" });
  });
  it("recognizes completed and canceled orders and rejects malformed calendar dates", () => {
    const shipment = ozon();
    shipment.ozonJob.response.statuses[0].status = "in_delivery_point";
    expect(estimatedDelivery(shipment, "PAID", now)).toEqual({ kind: "ready" });
    expect(estimatedDelivery(shipment, "CANCELED", now)).toEqual({ kind: "none" });
    expect(estimatedDelivery({ ...shipment, deliveredAt: now }, "PAID", now)).toEqual({ kind: "none" });
    expect(validDeliveryDate("2030-02-29")).toBe(false);
    expect(validDeliveryDate("2032-02-29")).toBe(true);
    expect(validDeliveryDate("2030-13-01")).toBe(false);
  });
});
