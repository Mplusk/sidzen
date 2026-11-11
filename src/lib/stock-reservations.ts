import { Prisma, type PrismaClient } from "@prisma/client";

type Tx = Prisma.TransactionClient;
type Line = { productId: string; quantity: number };

/** Lock products in a consistent order, then reserve the combined quantities. */
export async function reserveStock(tx: Tx, lines: Line[]) {
  const totals = new Map<string, number>();
  for (const line of lines) {
    if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) throw new Error("stock-changed");
    totals.set(line.productId, (totals.get(line.productId) ?? 0) + line.quantity);
  }
  const ids = [...totals.keys()].sort();
  if (!ids.length) throw new Error("stock-changed");
  const products = await tx.$queryRaw<{ id: string; stock: number; reservedStock: number; madeToOrder: boolean; status: string }[]>`
    SELECT "id", "stock", "reservedStock", "madeToOrder", "status"::text AS "status"
    FROM "Product" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`;
  if (products.length !== ids.length) throw new Error("stock-changed");
  // Pre-migration orders were not deducted or reserved. Do not guess whether
  // today's physical stock already accounts for them: require reconciliation.
  const legacy = await tx.orderItem.findFirst({ where: { productId: { in: ids }, order: { inventoryTracked: false } }, select: { id: true } });
  if (legacy) throw new Error("stock-legacy-review");
  const plan = products.map(product => {
    const amount = totals.get(product.id)!;
    if (!Number.isSafeInteger(amount) || product.status !== "PUBLISHED") throw new Error("stock-changed");
    const available = Math.max(0, product.stock - product.reservedStock);
    if (!product.madeToOrder && available < amount) throw new Error("stock-changed");
    return { id: product.id, held: Math.min(amount, available) };
  });
  const reserved = new Map<string, number>();
  for (const { id, held } of plan) {
    if (!held) continue;
    await tx.product.update({ where: { id }, data: { reservedStock: { increment: held } } });
    reserved.set(id, held);
  }
  return reserved;
}

/** End an active reservation exactly once. Never call for unverified returns. */
export async function finishStockReservations(tx: Tx, orderId: string, outcome: "RELEASED" | "CONSUMED") {
  const lines = await tx.orderItem.findMany({ where: { orderId, stockReservationState: "ACTIVE", reservedStock: { gt: 0 }, productId: { not: null } }, orderBy: [{ productId: "asc" }, { id: "asc" }] });
  for (const line of lines) {
    const changed = await tx.orderItem.updateMany({ where: { id: line.id, stockReservationState: "ACTIVE" }, data: { stockReservationState: outcome } });
    if (!changed.count || !line.productId) continue;
    const updated = await tx.product.updateMany({ where: { id: line.productId, reservedStock: { gte: line.reservedStock }, ...(outcome === "CONSUMED" ? { stock: { gte: line.reservedStock } } : {}) }, data: { reservedStock: { decrement: line.reservedStock }, ...(outcome === "CONSUMED" ? { stock: { decrement: line.reservedStock } } : {}) } });
    if (updated.count !== 1) throw new Error("stock-inconsistent");
  }
}

/** Only release when no carrier request could have left the shop. */
export async function releaseUnsentStock(tx: Tx, orderId: string) {
  const order = await tx.order.findUnique({ where: { id: orderId }, include: { shipment: { include: { ozonJob: true, cdekJob: true } } } });
  if (!order || order.shipment?.shippedAt || order.shipment?.deliveredAt || ["SHIPPED", "DELIVERED", "REFUNDED"].includes(order.status)) return false;
  for (const job of [order.shipment?.ozonJob, order.shipment?.cdekJob]) {
    if (job && (job.attempts !== 0 || job.lockToken || !["PENDING", "CANCELED"].includes(job.status))) return false;
  }
  const ozon = order.shipment?.ozonJob;
  if (ozon?.status === "PENDING") {
    const stopped = await tx.ozonDeliveryJob.updateMany({ where: { id: ozon.id, status: "PENDING", attempts: 0, lockToken: null }, data: { status: "CANCELED", cancelRequestedAt: new Date() } });
    if (!stopped.count) throw new Error("stock-carrier-changed");
  }
  const cdek = order.shipment?.cdekJob;
  if (cdek?.status === "PENDING") {
    const stopped = await tx.cdekDeliveryJob.updateMany({ where: { id: cdek.id, status: "PENDING", attempts: 0, lockToken: null }, data: { status: "CANCELED", cancelRequestedAt: new Date() } });
    if (!stopped.count) throw new Error("stock-carrier-changed");
  }
  await finishStockReservations(tx, orderId, "RELEASED");
  return true;
}

export type StockClient = PrismaClient | Tx;
