import { prisma } from "@/lib/prisma";
import { operatorReady } from "@/lib/privacy";
import { CONSENT_VERSION } from "@/lib/privacy-documents";
import { buildOzonPostings } from "./ozon-quote";
import { deliveryConfigFingerprint, getOzonDeliveryConfig, OZON_DELIVERY_CODE, requireOzonDelivery } from "./ozon-config";
import { ozonCreateBody } from "./ozon-worker";
import { retryOzonQuote } from "./ozon-retry";
import { z } from "zod";

// Explicit repair for requests made during the delivery-preference-only release.
// Never backfill shipped, completed, deleted or manually tracked applications.
export async function queueExistingOzonApplication(orderId: string, actorId?: string) {
  if (!await operatorReady()) throw new Error("operator");
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: { include: { product: true } }, shipment: { include: { ozonJob: true } } } });
  if (!order || order.deletedAt || order.kind !== "APPLICATION" || !["NEW", "APPROVED", "IN_PROGRESS"].includes(order.status) || order.shipment?.provider !== OZON_DELIVERY_CODE || order.shipment.tracking) throw new Error("ineligible");
  if (order.shipment.ozonJob) return order.shipment.ozonJob.id;
  const consent = await prisma.privacyConsent.findFirst({ where: { orderId, purpose: "ozon", version: CONSENT_VERSION, revokedAt: null } });
  if (!consent) throw new Error("consent");
  const point = z.object({ pointId: z.number().int().positive() }).parse(order.shipment.payload);
  const config = await getOzonDeliveryConfig(); requireOzonDelivery(config);
  const request = { recipient: { phone_number: order.customerPhone }, delivery: { delivery_point: { delivery_point_id: point.pointId } }, postings: buildOzonPostings(order.items.map(item => ({ id: item.id, quantity: item.quantity, unitPrice: Number(item.unitPrice), config: item.configuration, product: item.product })), config) };
  const { value: fresh } = await retryOzonQuote(config, api => api.checkout(request));
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412027)`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412026)`;
    const current = await tx.order.findUnique({ where: { id: orderId }, include: { shipment: { include: { ozonJob: true } } } });
    const currentConfig = await getOzonDeliveryConfig(tx); requireOzonDelivery(currentConfig);
    if (!current || current.deletedAt || current.updatedAt.getTime() !== order.updatedAt.getTime() || current.shipment?.tracking || deliveryConfigFingerprint(currentConfig) !== deliveryConfigFingerprint(config)) throw new Error("changed");
    if (current.shipment?.ozonJob) return current.shipment.ozonJob.id;
    if (!await tx.privacyConsent.findFirst({ where: { id: consent.id, revokedAt: null, orderId } })) throw new Error("consent");
    const job = await tx.ozonDeliveryJob.create({ data: { shipmentId: order.shipment!.id, clientId: config.clientId, request: ozonCreateBody(request, order.number, order.customerName, order.items.flatMap(item => Array.from({ length: item.quantity }, () => item.productName))) } });
    await tx.shipment.update({ where: { id: order.shipment!.id }, data: { cost: fresh.cost } });
    await tx.auditLog.create({ data: { actorId, action: "integration.ozon-delivery.queue-application", entityType: "Order", entityId: orderId, after: { repaired: true } } });
    return job.id;
  });
}
