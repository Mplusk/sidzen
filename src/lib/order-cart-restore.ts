import { Prisma } from "@prisma/client";

type Tx = Prisma.TransactionClient;
type SourceOrder = {
  id: string;
  userId: string | null;
  checkoutCartId: string | null;
  cartRestoredAt: Date | null;
  deletedAt: Date | null;
  personalDataErasedAt: Date | null;
};

/** Acquire product locks before a cart lock, matching normal cart mutations. */
export async function lockOrderProductsForCartReturn(tx: Tx, orderId: string) {
  const items = await tx.orderItem.findMany({ where: { orderId }, select: { productId: true } });
  const ids = [...new Set(items.flatMap(item => item.productId ? [item.productId] : []))].sort();
  if (ids.length) await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Product" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`);
}

/** Return snapshots only to the authenticated owner's cart or the original guest cart. */
export async function returnOrderToCart(tx: Tx, order: SourceOrder, now = new Date()) {
  if (order.cartRestoredAt || order.deletedAt || order.personalDataErasedAt) return false;
  const items = await tx.orderItem.findMany({ where: { orderId: order.id, productId: { not: null } }, orderBy: { id: "asc" } });
  if (!items.length) return false;
  let cart;
  if (order.userId) {
    if (!await tx.user.findFirst({ where: { id: order.userId, isActive: true }, select: { id: true } })) return false;
    cart = await tx.cart.upsert({ where: { userId: order.userId }, create: { userId: order.userId }, update: {} });
  } else if (order.checkoutCartId) {
    cart = await tx.cart.findFirst({ where: { id: order.checkoutCartId, userId: null, sessionKey: { not: null } } });
  }
  if (!cart) return false;
  await tx.$queryRaw`SELECT "id" FROM "Cart" WHERE "id" = ${cart.id} FOR UPDATE`;
  const target = await tx.cart.findUnique({ where: { id: cart.id }, select: { userId: true, sessionKey: true } });
  if (!target || (order.userId ? target.userId !== order.userId : !!target.userId || !target.sessionKey)) return false;
  await tx.cartItem.createMany({ data: items.map(item => ({ cartId: cart.id, productId: item.productId, variantId: item.variantId, returnedOrderItemId: item.id, quantity: item.quantity, unitPrice: item.unitPrice, config: item.configuration === null ? Prisma.DbNull : item.configuration as Prisma.InputJsonValue })) });
  await tx.order.update({ where: { id: order.id }, data: { cartRestoredAt: now, checkoutCartId: null } });
  return true;
}

/** A late successful payment removes only untouched returns, never a live cart hold. */
export async function removeUnchangedReturnedItems(tx: Tx, orderId: string) {
  const rows = await tx.cartItem.findMany({ where: { returnedOrderItem: { orderId } }, select: { cartId: true } });
  for (const cartId of [...new Set(rows.map(row => row.cartId))].sort()) {
    await tx.$queryRaw`SELECT "id" FROM "Cart" WHERE "id" = ${cartId} FOR UPDATE`;
    if (await tx.cartStockHold.findUnique({ where: { cartId }, select: { id: true } })) continue;
    await tx.cartItem.deleteMany({ where: { cartId, returnedOrderItem: { orderId } } });
  }
}
