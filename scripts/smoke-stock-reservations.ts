import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { reserveStock, finishStockReservations, releaseUnsentStock } from "../src/lib/stock-reservations";

// This test writes and deletes fixtures. Never allow it to connect to production.
const connection = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(connection.hostname) || connection.pathname !== "/shop_qa") {
  throw new Error("Stock smoke requires a local shop_qa database");
}
const db = new PrismaClient();
const tag = `stock-smoke-${randomUUID()}`;
const productIds: string[] = [];
const orderIds: string[] = [];
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
  await db.order.deleteMany({ where: { number: { startsWith: tag } } });
  await db.product.deleteMany({ where: { id: { in: productIds } } });
  await db.$disconnect();
}).catch(error => { console.error(error); process.exitCode = 1; });
