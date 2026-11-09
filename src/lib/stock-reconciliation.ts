import { prisma } from "@/lib/prisma";
import { finishStockReservations } from "@/lib/stock-reservations";

/** Release only after an operator verifies the goods are physically available. */
export async function releaseReviewedStock(input: { orderId: string; number: string; reason: string; actorId: string }) {
  return prisma.$transaction(async tx => {
    // Serialize with payment and order transitions. Carrier rows are locked
    // separately because delivery workers do not use these advisory locks.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412026)`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412034)`;
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${input.orderId} FOR UPDATE`;
    const order = await tx.order.findUnique({ where: { id: input.orderId }, include: { payment: true, shipment: { include: { ozonJob: true, cdekJob: true } }, items: true } });
    if (!order || order.number !== input.number || order.personalDataErasedAt) throw new Error("missing");
    if (!order.deletedAt && !["CANCELED", "REFUNDED"].includes(order.status)) throw new Error("order-active");
    if (order.payment && !["CANCELED", "REFUNDED"].includes(order.payment.status)) throw new Error("payment-active");
    const ozonId = order.shipment?.ozonJob?.id, cdekId = order.shipment?.cdekJob?.id;
    if (ozonId) await tx.$queryRaw`SELECT "id" FROM "OzonDeliveryJob" WHERE "id" = ${ozonId} FOR UPDATE`;
    if (cdekId) await tx.$queryRaw`SELECT "id" FROM "CdekDeliveryJob" WHERE "id" = ${cdekId} FOR UPDATE`;
    const ozon = ozonId ? await tx.ozonDeliveryJob.findUnique({ where: { id: ozonId } }) : null;
    const cdek = cdekId ? await tx.cdekDeliveryJob.findUnique({ where: { id: cdekId } }) : null;
    if ((ozonId && !ozon) || (cdekId && !cdek) || [ozon, cdek].some(job => job && (job.status !== "CANCELED" || job.lockToken))) throw new Error("delivery-active");
    const active = order.items.filter(item => item.stockReservationState === "ACTIVE" && item.reservedStock > 0);
    if (!active.length) throw new Error("no-reservation");
    if (active.some(item => !item.productId)) throw new Error("stock-inconsistent");
    await finishStockReservations(tx, order.id, "RELEASED");
    await tx.auditLog.create({ data: { actorId: input.actorId, action: "order.stock.release.reviewed", entityType: "Order", entityId: order.id, after: { number: order.number, reason: input.reason, items: active.map(item => ({ id: item.id, productId: item.productId, quantity: item.reservedStock })) } } });
    return order.number;
  });
}
