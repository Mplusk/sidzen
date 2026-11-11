import { Prisma, type PrismaClient } from "@prisma/client";
import { expireCartHold } from "@/lib/cart-stock-holds";
import { releaseUnsentStock } from "@/lib/stock-reservations";
import { EXPIRATION_MARKER } from "@/lib/late-order-stock";
import { lockOrderProductsForCartReturn, returnOrderToCart } from "@/lib/order-cart-restore";
import { queueTelegramCancellation } from "@/lib/telegram/status";

/** Never free stock when payment has succeeded or carrier processing began. */
export async function expireUnpaidOrderHold(db: PrismaClient, orderId: string, now = new Date()) {
  return db.$transaction(async tx => {
    // Use the same locks and order as payment verification and payment creation.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412026)`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412034)`;
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { payment: true, shipment: { include: { ozonJob: true, cdekJob: true } } } });
    if (!order || order.deletedAt || order.kind !== "ORDER" || !order.reservationExpiresAt || order.reservationExpiresAt > now || order.reservationExpiredAt || !["NEW", "APPROVED", "AWAITING_PAYMENT"].includes(order.status) || order.payment?.provider !== "yookassa-online" || order.payment.status !== "PENDING") return false;
    await lockOrderProductsForCartReturn(tx, order.id);
    if (!await releaseUnsentStock(tx, order.id)) return false;
    if (order.shipment?.ozonJob?.status === "PENDING") await tx.ozonDeliveryJob.updateMany({ where: { id: order.shipment.ozonJob.id, status: "CANCELED", attempts: 0 }, data: { cancelError: EXPIRATION_MARKER } });
    if (order.shipment?.cdekJob?.status === "PENDING") await tx.cdekDeliveryJob.updateMany({ where: { id: order.shipment.cdekJob.id, status: "CANCELED", attempts: 0 }, data: { error: EXPIRATION_MARKER } });
    const cartRestored = await returnOrderToCart(tx, order, now);
    await tx.order.update({ where: { id: order.id }, data: { status: "CANCELED", statusChangedAt: now, reservationExpiredAt: now, reservationExpiresAt: null, checkoutCartId: null } });
    await queueTelegramCancellation(tx, order.id);
    // A payment creation request can have reached the provider even when its
    // response was lost. Keep this visible for reconciliation; do not recreate it.
    if (!order.payment.externalId && order.payment.payload && typeof order.payment.payload === "object" && !Array.isArray(order.payment.payload)) {
      await tx.payment.update({ where: { id: order.payment.id }, data: { payload: { ...order.payment.payload, reconciliationRequired: true } as Prisma.InputJsonValue } });
    }
    await tx.auditLog.create({ data: { action: "order.stock.reservation-expired", entityType: "Order", entityId: order.id, after: { reason: "payment-timeout", cartRestored } } });
    return true;
  });
}

/** Short bounded batches keep the finance and carrier workers responsive. */
export async function releaseExpiredStockHolds(db: PrismaClient, now = new Date()) {
  const [holds, orders] = await Promise.all([
    db.cartStockHold.findMany({ where: { expiresAt: { lte: now } }, select: { id: true }, orderBy: { expiresAt: "asc" }, take: 25 }),
    db.order.findMany({ where: { kind: "ORDER", reservationExpiresAt: { lte: now }, reservationExpiredAt: null, payment: { is: { provider: "yookassa-online", status: "PENDING" } } }, select: { id: true }, orderBy: { reservationExpiresAt: "asc" }, take: 25 }),
  ]);
  let changed = false;
  for (const hold of holds) changed = await expireCartHold(db, hold.id, now) || changed;
  for (const order of orders) changed = await expireUnpaidOrderHold(db, order.id, now) || changed;
  return changed;
}
