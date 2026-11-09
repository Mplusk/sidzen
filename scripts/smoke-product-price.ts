import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { applySnapshot, marketplaceLock } from "../src/lib/marketplaces/sync";
import { defaultProductPrice } from "../src/lib/product-options";
import { productOptionInclude, productOptions } from "../src/lib/product-options-server";
import { writeProductPrice } from "../src/lib/product-price-write";

// Fixture creation and cleanup must never run against a real shop database.
const connection = new URL(process.env.DATABASE_URL ?? "");
if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(connection.hostname) || connection.pathname !== "/shop_qa") throw new Error("Price smoke requires local shop_qa");
const db = new PrismaClient();
const tag = `qa-price-${randomUUID()}`;
const ids: string[] = [];
let actorId = "";
let runId = "";

async function createProduct(suffix: string) {
  const product = await db.product.create({ data: { sku: `${tag}-${suffix}`, slug: `${tag}-${suffix}`, name: `QA price ${suffix}`, basePrice: 240, oldPrice: 399, status: "PUBLISHED", stock: 2 } });
  ids.push(product.id);
  return product;
}

function input(product: Awaited<ReturnType<typeof createProduct>>, price: string, previous: string | null, acceptSiteMode = true) {
  return { id: product.id, version: product.updatedAt, originalStatus: product.status, originalBasePrice: product.basePrice, originalOldPrice: product.oldPrice, basePrice: new Prisma.Decimal(price), oldPrice: previous === null ? null : new Prisma.Decimal(previous), actorId, canPublish: true, acceptSiteMode };
}

async function main() {
  actorId = (await db.user.create({ data: { email: `${tag}@example.test`, passwordHash: "qa-only" } })).id;
  const product = await createProduct("linked");
  const snapshot = { externalId: tag, sku: product.sku, barcodes: [`${tag}-barcode`], name: product.name, description: null, specifications: null, price: 240, oldPrice: 399, images: [], issue: null };
  await db.$transaction(async tx => { await marketplaceLock(tx); await applySnapshot(tx, "wb", tag, snapshot); });
  const linked = await db.product.findUniqueOrThrow({ where: { id: product.id } });
  assert.equal(linked.marketplaceMode, "AUTO");
  assert.equal(await db.marketplaceListing.count({ where: { productId: product.id } }), 1);
  await db.productVariant.create({ data: { productId: product.id, sku: `${tag}-variant`, price: 777 } });

  await assert.rejects(db.$transaction(tx => writeProductPrice(tx, input(linked, "250.50", null, false))), /confirm-site-mode/);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: product.id } })).marketplaceMode, "AUTO");
  assert.equal(await db.auditLog.count({ where: { entityId: product.id, action: "product.price.update" } }), 0);
  await assert.rejects(db.$transaction(tx => writeProductPrice(tx, { ...input(linked, "250.50", null), canPublish: false })), /permission/);
  await db.$transaction(tx => writeProductPrice(tx, input(linked, "250.50", null)));
  let current = await db.product.findUniqueOrThrow({ where: { id: product.id }, include: productOptionInclude });
  assert.equal(current.basePrice.toString(), "250.5");
  assert.equal(current.oldPrice, null);
  assert.equal(current.marketplaceMode, "SITE");
  assert.equal(defaultProductPrice(productOptions(current)), 777, "editing base price does not change a variant's storefront price");
  assert.equal(await db.auditLog.count({ where: { entityId: product.id, action: "product.price.update" } }), 1);
  await db.$transaction(async tx => { await marketplaceLock(tx); await applySnapshot(tx, "wb", tag, { ...snapshot, name: "Marketplace changed", price: 999, oldPrice: 1200 }); });
  current = await db.product.findUniqueOrThrow({ where: { id: product.id }, include: productOptionInclude });
  assert.equal(current.basePrice.toString(), "250.5", "marketplace refresh must not replace site-managed price");
  assert.equal(current.oldPrice, null);
  assert.equal(current.name, product.name);

  const stale = await createProduct("stale");
  await db.product.update({ where: { id: stale.id }, data: { basePrice: 241, updatedAt: stale.updatedAt } });
  await assert.rejects(db.$transaction(tx => writeProductPrice(tx, input(stale, "300", "500"))), /stale/);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: stale.id } })).basePrice.toString(), "241");
  assert.equal(await db.auditLog.count({ where: { entityId: stale.id, action: "product.price.update" } }), 0);

  const rollback = await createProduct("rollback");
  await assert.rejects(db.$transaction(tx => writeProductPrice(tx, { ...input(rollback, "300", null), actorId: `${tag}-missing-actor` })));
  const afterRollback = await db.product.findUniqueOrThrow({ where: { id: rollback.id } });
  assert.equal(afterRollback.basePrice.toString(), "240", "failed audit must roll back price changes");
  assert.equal(afterRollback.oldPrice?.toString(), "399");
  assert.equal(await db.auditLog.count({ where: { entityId: rollback.id, action: "product.price.update" } }), 0);

  const concurrent = await createProduct("concurrent");
  const results = await Promise.allSettled(["310", "320"].map(price => db.$transaction(tx => writeProductPrice(tx, input(concurrent, price, "500")))));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1, "exactly one edit of the same snapshot must succeed");
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  assert.match(String(rejected?.reason), /stale/);
  assert.equal(await db.auditLog.count({ where: { entityId: concurrent.id, action: "product.price.update" } }), 1);

  const busy = await createProduct("busy");
  runId = (await db.marketplaceSyncRun.create({ data: { provider: "wb", accountId: tag, status: "QUEUED" } })).id;
  await assert.rejects(db.$transaction(tx => writeProductPrice(tx, input(busy, "350", null))), /marketplace-busy/);
  assert.equal((await db.product.findUniqueOrThrow({ where: { id: busy.id } })).basePrice.toString(), "240");
  assert.equal(await db.auditLog.count({ where: { entityId: busy.id, action: "product.price.update" } }), 0);
  console.log("PASS: real PostgreSQL price changes, old-price removal, permission, marketplace consent/protection, variant price, stale/concurrent edit, sync guard and audit.");
}

main().finally(async () => {
  if (runId) await db.marketplaceSyncRun.deleteMany({ where: { id: runId } });
  await db.auditLog.deleteMany({ where: { entityId: { in: ids }, action: "product.price.update" } });
  await db.marketplaceListing.deleteMany({ where: { accountId: tag } });
  await db.product.deleteMany({ where: { id: { in: ids } } });
  if (actorId) await db.user.deleteMany({ where: { id: actorId } });
  await db.$disconnect();
}).catch(error => { console.error(error); process.exitCode = 1; });
