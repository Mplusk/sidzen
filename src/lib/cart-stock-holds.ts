import { Prisma, type PrismaClient } from "@prisma/client";
import { reserveStock } from "@/lib/stock-reservations";

type Tx = Prisma.TransactionClient;
type Line = { productId: string; quantity: number };
type Hold = Prisma.CartStockHoldGetPayload<{ include: { items: true } }>;
type Stock = { id: string; stock: number; reservedStock: number; madeToOrder: boolean; status: string };

export const CART_HOLD_MS = 30 * 60_000;
export const PAYMENT_HOLD_MS = 10 * 60_000;

async function lockProducts(tx: Tx, ids: string[]) {
  if (!ids.length) return [];
  return tx.$queryRaw<Stock[]>(Prisma.sql`SELECT "id", "stock", "reservedStock", "madeToOrder", "status"::text AS "status" FROM "Product" WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`);
}

/** Product locks precede the cart lock everywhere that a cart hold is changed. */
export async function lockCartHold(tx: Tx, cartId: string, additionalProductIds: string[] = []) {
  const snapshot = await tx.cartStockHold.findUnique({ where: { cartId }, include: { items: true } });
  const ids = [...new Set([...additionalProductIds, ...(snapshot?.items.map(item => item.productId) ?? [])])].sort();
  const products = await lockProducts(tx, ids);
  const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Cart" WHERE "id" = ${cartId} FOR UPDATE`;
  if (!locked.length) throw new Error("cart-changed");
  const hold = await tx.cartStockHold.findUnique({ where: { cartId }, include: { items: true } });
  // A concurrently added item needs a fresh lock set; retry on the next request.
  if (hold?.items.some(item => !ids.includes(item.productId))) throw new Error("cart-changed");
  return { hold, products };
}

/** The caller must already hold locks for every product and the cart/hold. */
export async function releaseLockedCartHold(tx: Tx, hold: Hold) {
  for (const item of [...hold.items].sort((a, b) => a.productId.localeCompare(b.productId))) {
    const changed = await tx.product.updateMany({ where: { id: item.productId, reservedStock: { gte: item.quantity } }, data: { reservedStock: { decrement: item.quantity } } });
    if (changed.count !== 1) throw new Error("stock-inconsistent");
  }
  await tx.cartStockHold.delete({ where: { id: hold.id } });
}

/** Release an expired hold exactly once, even if its cart was deleted. */
export async function expireCartHold(db: PrismaClient, holdId: string, now = new Date()) {
  return db.$transaction(async tx => {
    const snapshot = await tx.cartStockHold.findUnique({ where: { id: holdId }, include: { items: true } });
    if (!snapshot || snapshot.expiresAt > now) return false;
    const ids = [...new Set(snapshot.items.map(item => item.productId))].sort();
    await lockProducts(tx, ids);
    if (snapshot.cartId) await tx.$queryRaw`SELECT "id" FROM "Cart" WHERE "id" = ${snapshot.cartId} FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "CartStockHold" WHERE "id" = ${holdId} FOR UPDATE`;
    const hold = await tx.cartStockHold.findUnique({ where: { id: holdId }, include: { items: true } });
    if (!hold || hold.expiresAt > now) return false;
    if (hold.items.some(item => !ids.includes(item.productId))) throw new Error("cart-changed");
    await releaseLockedCartHold(tx, hold);
    return true;
  });
}

/** Rebalance the affected product after editing a cart that has an active hold. */
export async function adjustLockedCartHold(tx: Tx, hold: Hold | null, product: Stock | undefined, productId: string, quantity: number, allowIncrease = true, now = new Date()) {
  if (!hold) return;
  if (hold.expiresAt <= now) { await releaseLockedCartHold(tx, hold); return; }
  if (!product) throw new Error("cart-changed");
  const previous = hold.items.find(item => item.productId === productId)?.quantity ?? 0;
  const free = Math.max(0, product.stock - product.reservedStock + previous);
  if (allowIncrease && quantity > 0 && (product.status !== "PUBLISHED" || (!product.madeToOrder && quantity > free))) throw new Error("stock-changed");
  const desired = Math.min(quantity, free, allowIncrease ? Infinity : previous);
  const difference = desired - previous;
  if (difference) {
    const changed = await tx.product.updateMany({ where: { id: productId, reservedStock: { gte: Math.max(0, -difference) } }, data: { reservedStock: { increment: difference } } });
    if (changed.count !== 1) throw new Error("stock-inconsistent");
  }
  if (desired > 0) await tx.cartStockHoldItem.upsert({ where: { holdId_productId: { holdId: hold.id, productId } }, create: { holdId: hold.id, productId, quantity: desired }, update: { quantity: desired } });
  else if (previous) await tx.cartStockHoldItem.deleteMany({ where: { holdId: hold.id, productId } });
}

/** Convert a cart hold into an order reservation without a stock release gap. */
export async function reserveOrderFromCart(tx: Tx, cartId: string, lines: Line[], now = new Date()) {
  const { hold } = await lockCartHold(tx, cartId, lines.map(line => line.productId));
  const originalExpiry = hold && hold.expiresAt > now ? hold.expiresAt : null;
  if (hold) await releaseLockedCartHold(tx, hold);
  const reserved = await reserveStock(tx, lines);
  const expiresAt = new Date(Math.max(now.getTime() + PAYMENT_HOLD_MS, originalExpiry?.getTime() ?? 0));
  return { reserved, expiresAt };
}

/** Called under the payment locks only for an explicit customer payment attempt. */
export async function extendOrderPaymentHold(tx: Tx, order: { id: string; reservationExpiresAt: Date | null; reservationExpiredAt: Date | null }, now = new Date()) {
  if (order.reservationExpiredAt || (order.reservationExpiresAt && order.reservationExpiresAt <= now)) throw new Error("payment-state");
  // Older orders have no timed reservation; do not change their existing policy.
  if (!order.reservationExpiresAt) return null;
  const expiresAt = new Date(Math.max(order.reservationExpiresAt.getTime(), now.getTime() + PAYMENT_HOLD_MS));
  if (expiresAt > order.reservationExpiresAt) await tx.order.update({ where: { id: order.id }, data: { reservationExpiresAt: expiresAt } });
  return expiresAt;
}

type CartSnapshot = { id: string; items: Array<{ id: string; productId: string | null; quantity: number; updatedAt: Date; available: boolean }> };

/** A repeated click never prolongs an already-running 30-minute hold. */
export async function holdCartForCheckout(db: PrismaClient, cart: CartSnapshot, now = new Date()) {
  const lines = cart.items.filter(item => item.available).map(item => {
    if (!item.productId) throw new Error("cart-changed");
    return { productId: item.productId, quantity: item.quantity };
  });
  if (!lines.length) throw new Error("stock-changed");
  return db.$transaction(async tx => {
    const { hold, products } = await lockCartHold(tx, cart.id, lines.map(line => line.productId));
    const current = await tx.cartItem.findMany({ where: { cartId: cart.id, product: { type: { in: ["READY", "PARAMETRIC"] } } }, select: { id: true, productId: true, quantity: true, updatedAt: true } });
    if (current.length !== cart.items.length || cart.items.some(item => !current.some(row => row.id === item.id && row.productId === item.productId && row.quantity === item.quantity && row.updatedAt.getTime() === item.updatedAt.getTime()))) throw new Error("cart-changed");
    if (hold && hold.expiresAt > now) {
      const totals = new Map<string, number>();
      for (const line of lines) totals.set(line.productId, (totals.get(line.productId) ?? 0) + line.quantity);
      const ids = [...new Set([...totals.keys(), ...hold.items.map(item => item.productId)])].sort();
      for (const productId of ids) {
        const quantity = totals.get(productId) ?? 0;
        await adjustLockedCartHold(tx, hold, products.find(product => product.id === productId), productId, quantity, quantity > 0, now);
      }
      return hold.expiresAt;
    }
    if (hold) await releaseLockedCartHold(tx, hold);
    const reserved = await reserveStock(tx, lines);
    const expiresAt = new Date(now.getTime() + CART_HOLD_MS);
    await tx.cartStockHold.create({ data: { cartId: cart.id, expiresAt, items: { create: [...reserved].map(([productId, quantity]) => ({ productId, quantity })) } } });
    return expiresAt;
  });
}
