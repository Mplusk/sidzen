import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";

type ReviewOrder = Prisma.OrderGetPayload<{ include: { items: true; payment: true; shipment: { include: { ozonJob: true; cdekJob: true } } } }>;

/** Only values material to an operator's inventory decision are exposed to the hash. */
export function legacyStockReviewSnapshot(order: ReviewOrder) {
  const shipment = order.shipment;
  return createHash("sha256").update(JSON.stringify({
    status: order.status, deletedAt: order.deletedAt, purchaseConfirmedAt: order.purchaseConfirmedAt,
    items: [...order.items].sort((a, b) => a.id.localeCompare(b.id)).map(item => ({ id: item.id, productId: item.productId, quantity: item.quantity, productName: item.productName, sku: item.sku, configuration: item.configuration })),
    payment: order.payment && { id: order.payment.id, status: order.payment.status, refundReviewRequired: order.payment.refundReviewRequired },
    shipment: shipment && { id: shipment.id, provider: shipment.provider, tracking: shipment.tracking, shippedAt: shipment.shippedAt, deliveredAt: shipment.deliveredAt,
      ozon: shipment.ozonJob && { id: shipment.ozonJob.id, status: shipment.ozonJob.status, response: shipment.ozonJob.response, cancelRequestedAt: shipment.ozonJob.cancelRequestedAt },
      cdek: shipment.cdekJob && { id: shipment.cdekJob.id, status: shipment.cdekJob.status, deliveryStatus: shipment.cdekJob.deliveryStatus, cancelRequestedAt: shipment.cdekJob.cancelRequestedAt } },
  })).digest("hex");
}
