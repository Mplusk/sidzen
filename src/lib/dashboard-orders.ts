import type { Prisma } from "@prisma/client";

// The carrier may still be moving an order that was manually marked delivered.
// Keep conflicting or unfinished shipments visible until they can be reconciled.
const unresolvedCarrier: Prisma.OrderWhereInput = {
  OR: [
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
