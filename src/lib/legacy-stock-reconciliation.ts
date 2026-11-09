import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { legacyStockReviewSnapshot } from "@/lib/legacy-stock-review-snapshot";

type Snapshot = { id: string; stock: number; reservedStock: number };

/** The operator adjusts physical stock first; this only records verification. */
export async function confirmLegacyStock(input: { orderId: string; number: string; reason: string; products: Snapshot[]; reviewSnapshot: string; actorId: string }) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412026)`;
    // Legacy payment reconciliation can update Payment before Order without
    // taking the advisory lock, so preserve that order here too.
    await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "orderId" = ${input.orderId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${input.orderId} FOR UPDATE`;
    const include = { items: true, payment: true, shipment: { include: { ozonJob: true, cdekJob: true } } } as const;
    const order = await tx.order.findUnique({ where: { id: input.orderId }, include });
    if (!order || order.number !== input.number || order.inventoryTracked || order.personalDataErasedAt) throw new Error("changed");
    const ids = [...new Set(order.items.flatMap(item => item.productId ? [item.productId] : []))].sort();
    // The same product locks protect this decision against checkout and an
    // administrator changing physical stock while confirmation is submitted.
    const current = ids.length ? await tx.$queryRaw<Snapshot[]>(Prisma.sql`SELECT "id", "stock", "reservedStock" FROM "Product" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`) : [];
    const expected = new Map(input.products.map(product => [product.id, product]));
    if (current.length !== expected.size || current.some(product => product.stock !== expected.get(product.id)?.stock || product.reservedStock !== expected.get(product.id)?.reservedStock)) throw new Error("changed");
    // Delivery workers lock job before shipment. Lock in the same order, then
    // re-read all state; the parent order lock prevents new child insertions.
    const shipmentId = order.shipment?.id;
    if (shipmentId) {
      await tx.$queryRaw`SELECT "id" FROM "OzonDeliveryJob" WHERE "shipmentId" = ${shipmentId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "CdekDeliveryJob" WHERE "shipmentId" = ${shipmentId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "Shipment" WHERE "id" = ${shipmentId} FOR UPDATE`;
    }
    await tx.$queryRaw`SELECT "id" FROM "OrderItem" WHERE "orderId" = ${input.orderId} ORDER BY "id" FOR UPDATE`;
    const fresh = await tx.order.findUnique({ where: { id: input.orderId }, include });
    if (!fresh || fresh.inventoryTracked || fresh.personalDataErasedAt || legacyStockReviewSnapshot(fresh) !== input.reviewSnapshot) throw new Error("changed");
    const freshIds = [...new Set(fresh.items.flatMap(item => item.productId ? [item.productId] : []))].sort();
    if (JSON.stringify(freshIds) !== JSON.stringify(ids)) throw new Error("changed");
    await tx.order.update({ where: { id: order.id }, data: { inventoryTracked: true } });
    await tx.auditLog.create({ data: { actorId: input.actorId, action: "order.stock.legacy-reviewed", entityType: "Order", entityId: order.id, after: { number: order.number, reason: input.reason, products: current } } });
  });
}
