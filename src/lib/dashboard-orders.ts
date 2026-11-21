import type { Prisma } from "@prisma/client";

// The carrier may still be moving an order that was manually marked delivered.
// Keep conflicting or unfinished shipments visible until they can be reconciled.
const unresolvedCarrier: Prisma.OrderWhereInput = {
  OR: [
    { shipment: { is: { fivePostJob: { is: { status: { notIn: ["FINISHED"] } } } } } },
    { shipment: { is: { fivePostJob: { is: { status: "FINISHED", deliveryStatus: { not: "PICKED_UP" } } } } } },
    { shipment: { is: { ozonJob: { is: { status: { in: ["PENDING", "CREATED", "REVIEW", "CANCELED"] } } } } } },
    { shipment: { is: { cdekJob: { is: { status: { in: ["PENDING", "SENDING", "ACCEPTED", "CREATED", "REVIEW", "CANCELING", "CANCELED"] } } } } } },
    { shipment: { is: { cdekJob: { is: { status: "FINISHED", deliveryStatus: "NOT_DELIVERED" } } } } },
  ],
};

export const receivedOrdersWhere: Prisma.OrderWhereInput = {
  AND: [
    { NOT: unresolvedCarrier },
    { OR: [
      { status: "DELIVERED" },
      { status: { notIn: ["CANCELED", "REFUNDED"] }, shipment: { is: { deliveredAt: { not: null } } } },
    ] },
  ],
};

// Canceled orders belong in the archive even when a carrier cancellation is
// still pending; the dashboard must continue to show that carrier status.
export const archivedOrdersWhere: Prisma.OrderWhereInput = {
  OR: [{ status: "CANCELED" }, receivedOrdersWhere],
};
