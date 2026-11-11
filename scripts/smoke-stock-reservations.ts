import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { reserveStock, finishStockReservations, releaseUnsentStock } from "../src/lib/stock-reservations";
import { adjustLockedCartHold, expireCartHold, holdCartForCheckout, lockCartHold, reserveOrderFromCart } from "../src/lib/cart-stock-holds";
import { expireUnpaidOrderHold } from "../src/lib/stock-hold-expiration";
import { restoreExpiredOrderStock } from "../src/lib/late-order-stock";
import { applyYooKassaPayment } from "../src/lib/yookassa/payments";
import { prisma } from "../src/lib/prisma";

// This test writes and deletes fixtures. Never allow it to connect to production.
const connection = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(connection.hostname) || connection.pathname !== "/shop_qa") {
  throw new Error("Stock smoke requires a local shop_qa database");
}
const db = new PrismaClient();
const tag = `stock-smoke-${randomUUID()}`;
const productIds: string[] = [];
const orderIds: string[] = [];
const cartIds: string[] = [];
async function product(stock: number) {
  const id = `${tag}-${productIds.length}`;
  await db.product.create({ data: { id, sku: id, slug: id, name: "Stock QA", basePrice: 1, status: "PUBLISHED", stock, madeToOrder: false } });
  productIds.push(id); return id;
}
async function order(id: string, lines: Array<{ productId: string; quantity: number }>) {
  return db.$transaction(async tx => {
    const reserved = await reserveStock(tx, lines);
    const items = lines.map(line => {
      const remaining = reserved.get(line.productId) ?? 0;
      const held = Math.min(line.quantity, remaining);
      reserved.set(line.productId, remaining - held);
      return { ...line, productName: "Stock QA", unitPrice: 1, totalPrice: line.quantity, reservedStock: held, stockReservationState: held ? "ACTIVE" : "NONE" };
    });
    const value = await tx.order.create({ data: { number: id, inventoryTracked: true, customerName: "QA", customerEmail: "qa@example.test", customerPhone: "+79990000000", subtotal: 1, total: 1, items: { create: items } } });
    return value.id;
  });
}
async function main() {
  const moment = new Date();
  const contested = await product(1);
  async function cartFor(productId: string, quantity: number) {
    const value = await db.cart.create({ data: { sessionKey: `${tag}-cart-${cartIds.length}`, items: { create: { productId, quantity, unitPrice: 1 } } }, include: { items: true } });
    cartIds.push(value.id);
    return { ...value, items: value.items.map(item => ({ ...item, available: true })) };
  }
  const first = await cartFor(contested, 1), second = await cartFor(contested, 1);
  const attempts = await Promise.allSettled([holdCartForCheckout(db, first, moment), holdCartForCheckout(db, second, moment)]);
  const winnerIndex = attempts.findIndex(result => result.status === "fulfilled");
  assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1, "Exactly one cart holds the last product");
  const winner = winnerIndex === 0 ? first : second, loser = winnerIndex === 0 ? second : first;
  const firstExpiry = (attempts[winnerIndex] as PromiseFulfilledResult<Date>).value;
  assert.equal(firstExpiry.getTime(), moment.getTime() + 30 * 60_000);
  assert.equal((await holdCartForCheckout(db, winner, new Date(moment.getTime() + 5 * 60_000))).getTime(), firstExpiry.getTime(), "Repeated click must not extend a hold");
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: contested } })).reservedStock, 1);

  const placed = await db.$transaction(async tx => {
    const reservation = await reserveOrderFromCart(tx, winner.id, [{ productId: contested, quantity: 1 }], new Date(moment.getTime() + 25 * 60_000));
    const value = await tx.order.create({ data: { number: `${tag}-timed`, kind: "ORDER", status: "AWAITING_PAYMENT", inventoryTracked: true, reservationExpiresAt: reservation.expiresAt, customerName: "QA", customerEmail: "qa@example.test", customerPhone: "+79990000000", subtotal: 1, total: 1, items: { create: { productId: contested, productName: "Stock QA", quantity: 1, unitPrice: 1, totalPrice: 1, reservedStock: reservation.reserved.get(contested) ?? 0, stockReservationState: "ACTIVE" } }, payment: { create: { provider: "yookassa-online", amount: 1, status: "PENDING", externalId: randomUUID(), payload: { version: 1, shopId: "123", firstAttemptAt: moment.toISOString(), request: "synthetic-encrypted-request" } } } }, include: { payment: true } });
    return { order: value, expiresAt: reservation.expiresAt };
  });
  orderIds.push(placed.order.id);
  assert.equal(placed.expiresAt.getTime(), moment.getTime() + 35 * 60_000, "Payment has at least ten additional minutes from the click");
  assert.equal(await db.cartStockHold.count({ where: { cartId: winner.id } }), 0, "Hold transfers into the order");
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: contested } })).reservedStock, 1, "Transfer never doubles or releases the stock");
  assert.equal(await expireUnpaidOrderHold(db, placed.order.id, new Date(placed.expiresAt.getTime() - 1)), false);
  assert.equal(await expireUnpaidOrderHold(db, placed.order.id, new Date(placed.expiresAt.getTime() + 1)), true);
  assert.equal(await expireUnpaidOrderHold(db, placed.order.id, new Date(placed.expiresAt.getTime() + 2)), false, "Order expiration is idempotent");
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: contested } })).reservedStock, 0);
  const secondStart = new Date(placed.expiresAt.getTime() + 2);
  await holdCartForCheckout(db, loser, secondStart);
  await applyYooKassaPayment({ id: placed.order.payment!.externalId!, status: "succeeded", paid: true, test: false, amount: { value: "1.00", currency: "RUB" }, metadata: { orderId: placed.order.id, paymentId: placed.order.payment!.id }, recipient: { account_id: "123" } });
  assert.deepEqual(await db.order.findUniqueOrThrow({ where: { id: placed.order.id }, select: { status: true, stockReviewRequired: true } }), { status: "PAID", stockReviewRequired: true }, "A late paid order is flagged when another cart holds the last product");
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: contested } })).reservedStock, 1, "Late payment cannot steal another buyer's hold");
  const otherHold = await db.cartStockHold.findUniqueOrThrow({ where: { cartId: loser.id } });
  assert.equal(await expireCartHold(db, otherHold.id, new Date(secondStart.getTime() + 30 * 60_000)), true);
  assert.equal(await expireCartHold(db, otherHold.id, new Date(secondStart.getTime() + 30 * 60_000)), false);
  assert.equal(await db.$transaction(async tx => { const ok = await restoreExpiredOrderStock(tx, placed.order.id); if (ok) await tx.order.update({ where: { id: placed.order.id }, data: { stockReviewRequired: false } }); return ok; }), true, "A late payment can recover stock when it is still available");
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: contested } })).reservedStock, 1);

  const adjustable = await product(3), editable = await cartFor(adjustable, 2);
  await holdCartForCheckout(db, editable, moment);
  await db.$transaction(async tx => {
    const { hold, products } = await lockCartHold(tx, editable.id, [adjustable]);
    await adjustLockedCartHold(tx, hold, products.find(product => product.id === adjustable), adjustable, 1);
    await tx.cartItem.update({ where: { id: editable.items[0].id }, data: { quantity: 1 } });
  });
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: adjustable } })).reservedStock, 1, "Reducing quantity frees the difference immediately");
  const editableHold = await db.cartStockHold.findUniqueOrThrow({ where: { cartId: editable.id } });
  await expireCartHold(db, editableHold.id, new Date(moment.getTime() + 30 * 60_000));
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: adjustable } })).reservedStock, 0);

  const last = await product(1);
  const races = await Promise.allSettled([order(`${tag}-race-a`, [{ productId: last, quantity: 1 }]), order(`${tag}-race-b`, [{ productId: last, quantity: 1 }])]);
  const winners = races.filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled");
  assert.equal(winners.length, 1, "exactly one checkout can reserve the final unit");
  orderIds.push(winners[0].value);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: last } })).reservedStock, 1);

  const p = await product(5), other = await product(1);
  await assert.rejects(order(`${tag}-duplicate`, [{ productId: p, quantity: 3 }, { productId: p, quantity: 3 }]));
  await assert.rejects(order(`${tag}-rollback`, [{ productId: p, quantity: 2 }, { productId: other, quantity: 2 }]));
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: p } })).reservedStock, 0, "failed order rolls back all reservations");
  const before = await db.product.findUniqueOrThrow({ where: { id: p } });
  const id = await order(`${tag}-consume`, [{ productId: p, quantity: 1 }, { productId: p, quantity: 1 }]);
  orderIds.push(id);
  let record = await db.product.findUniqueOrThrow({ where: { id: p } });
  assert.equal(record.reservedStock, 2);
  assert.notDeepEqual([record.updatedAt.getTime(), record.reservedStock], [before.updatedAt.getTime(), before.reservedStock], "reservation invalidates stale product form");
  await db.$transaction(tx => finishStockReservations(tx, id, "CONSUMED"));
  await db.$transaction(tx => finishStockReservations(tx, id, "CONSUMED"));
  record = await db.product.findUniqueOrThrow({ where: { id: p } });
  assert.deepEqual([record.stock, record.reservedStock], [3, 0], "delivery is consumed once");
  const cancellation = await order(`${tag}-release`, [{ productId: p, quantity: 1 }]);
  orderIds.push(cancellation);
  await db.$transaction(tx => releaseUnsentStock(tx, cancellation));
  await db.$transaction(tx => releaseUnsentStock(tx, cancellation));
  record = await db.product.findUniqueOrThrow({ where: { id: p } });
  assert.deepEqual([record.stock, record.reservedStock], [3, 0], "cancellation releases once without inventing stock");
  await db.product.update({ where: { id: p }, data: { stock: 10 } });
  record = await db.product.findUniqueOrThrow({ where: { id: p } });
  assert.equal(record.stock - record.reservedStock, 10);
  const custom = await product(2);
  await db.product.update({ where: { id: custom }, data: { madeToOrder: true } });
  const customOrder = await order(`${tag}-custom`, [{ productId: custom, quantity: 3 }]);
  orderIds.push(customOrder);
  const customLine = await db.orderItem.findFirstOrThrow({ where: { orderId: customOrder } });
  assert.equal(customLine.reservedStock, 2, "made-to-order items reserve ready goods before manufacturing the remainder");
  const legacyProduct = await product(5);
  const legacyOrder = await db.order.create({ data: { number: `${tag}-legacy`, customerName: "QA", customerEmail: "qa@example.test", customerPhone: "+79990000000", subtotal: 1, total: 1, items: { create: { productId: legacyProduct, productName: "Legacy stock QA", quantity: 1, unitPrice: 1, totalPrice: 1 } } } });
  await assert.rejects(order(`${tag}-legacy-blocked`, [{ productId: legacyProduct, quantity: 1 }]), /stock-legacy-review/);
  await db.order.update({ where: { id: legacyOrder.id }, data: { status: "CANCELED" } });
  await assert.rejects(order(`${tag}-legacy-canceled-blocked`, [{ productId: legacyProduct, quantity: 1 }]), /stock-legacy-review/, "later cancellation cannot bypass reconciliation");
  await db.order.update({ where: { id: legacyOrder.id }, data: { inventoryTracked: true } });
  orderIds.push(await order(`${tag}-legacy-cleared`, [{ productId: legacyProduct, quantity: 1 }]));
  console.log("Stock reservation smoke passed");
}
main().finally(async () => {
  const paymentIds = (await db.payment.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } })).map(payment => payment.id);
  await db.auditLog.deleteMany({ where: { entityId: { in: [...orderIds, ...paymentIds] } } });
  await db.order.deleteMany({ where: { number: { startsWith: tag } } });
  await db.cartStockHold.deleteMany({ where: { cartId: { in: cartIds } } });
  await db.cart.deleteMany({ where: { id: { in: cartIds } } });
  await db.product.deleteMany({ where: { id: { in: productIds } } });
  await db.$disconnect();
  await prisma.$disconnect();
}).catch(error => { console.error(error); process.exitCode = 1; });
