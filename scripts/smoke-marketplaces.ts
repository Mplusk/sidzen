// Destructive test fixtures are confined to a disposable local QA database.
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { encryptSecret } from "../src/lib/integration-secrets";
import { applySnapshot, claimRun, guardProductWrite, mapListing, marketplaceLock, processRun } from "../src/lib/marketplaces/sync";
import { connectionKey, POLICY_KEY, type Provider, type Snapshot } from "../src/lib/marketplaces/model";

const url = new URL(process.env.DATABASE_URL || "");
assert(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/shop_qa", "Only the disposable local shop_qa database is allowed");
assert(process.env.AUTH_SECRET, "AUTH_SECRET required for fixture credentials");
const prefix = `MPQA-${Date.now()}`;
const accountId = `${prefix}-account`;
const productIds: string[] = [], runIds: string[] = [];
const originalFetch = globalThis.fetch;
const oldPolicy = await prisma.siteSetting.findUnique({ where: { key: POLICY_KEY } });
const oldConnection = await prisma.siteSetting.findUnique({ where: { key: connectionKey("ozon") } });
const category = await prisma.category.create({ data: { name: prefix, slug: prefix.toLowerCase() } });
const base: Snapshot = { externalId: "101", sku: prefix, barcodes: [`${prefix}-barcode`], name: `${prefix} product`, price: 150, oldPrice: 200, description: "Ozon text", specifications: { "Материал": "PLA" }, images: [], issue: null };
async function apply(provider: Provider, value: Snapshot, runId?: string) {
  return prisma.$transaction(async (tx) => { await marketplaceLock(tx); return applySnapshot(tx, provider, accountId, value, runId); }, { maxWait: 120_000, timeout: 120_000 });
}
async function remember(sku: string) { const product = await prisma.product.findUniqueOrThrow({ where: { sku } }); if (!productIds.includes(product.id)) productIds.push(product.id); return product; }
function fields(product: Awaited<ReturnType<typeof remember>>) { return { name: product.name, price: Number(product.basePrice), oldPrice: Number(product.oldPrice), description: product.description, specifications: product.specifications, status: product.status, stock: product.stock, shippingWeightG: product.shippingWeightG, shippingLengthMm: product.shippingLengthMm, shippingWidthMm: product.shippingWidthMm, shippingHeightMm: product.shippingHeightMm, weightGrams: product.weightGrams === null ? null : Number(product.weightGrams), widthMm: product.widthMm === null ? null : Number(product.widthMm) }; }
try {
  await prisma.siteSetting.upsert({ where: { key: POLICY_KEY }, create: { key: POLICY_KEY, group: "integrations", value: { primary: "ozon", categoryId: category.id } }, update: { value: { primary: "ozon", categoryId: category.id } } });
  const wb = { ...base, externalId: "201", name: `${prefix} WB title`, description: "WB text", price: 250 };
  await apply("ozon", base); await apply("wb", wb);
  const first = await remember(prefix);
  assert.equal(first.status, "DRAFT"); assert.equal(first.madeToOrder, false);
  assert.equal(await prisma.productCategory.count({ where: { productId: first.id, categoryId: category.id } }), 1);
  const canonical = fields(first);
  const measured: Snapshot = { ...base, measurements: { weightGrams: 65, widthMm: 45, packaging: { shippingWeightG: 85, shippingLengthMm: 190, shippingWidthMm: 55, shippingHeightMm: 70 } } };
  await apply("ozon", measured);
  assert.equal(Number((await remember(prefix)).weightGrams), 65);
  assert.equal((await remember(prefix)).shippingWeightG, 85);
  await apply("ozon", base); // A missing parcel must not clear an existing one.
  assert.equal((await remember(prefix)).shippingLengthMm, 190);
  // Restore this isolated fixture before the reverse-order comparison below.
  await prisma.product.update({ where: { id: first.id }, data: { weightGrams: null, widthMm: null, shippingWeightG: null, shippingLengthMm: null, shippingWidthMm: null, shippingHeightMm: null } });
  await apply("ozon", base); await apply("wb", wb);
  assert.equal(await prisma.product.count({ where: { sku: prefix } }), 1);
  assert.equal(await prisma.marketplaceListing.count({ where: { productId: first.id } }), 2);
  // Compare the reverse import order with an entirely clean mapping set.
  await prisma.marketplaceListing.deleteMany({ where: { productId: first.id } });
  await prisma.product.delete({ where: { id: first.id } });
  await apply("wb", wb); await apply("ozon", base);
  const reversed = await remember(prefix);
  assert.deepEqual(fields(reversed), canonical);
  await prisma.product.update({ where: { id: reversed.id }, data: { marketplaceMode: "SITE" } });
  await apply("ozon", measured);
  assert.equal((await remember(prefix)).shippingWeightG, 85);
  assert.equal((await remember(prefix)).shippingLengthMm, 190);
  assert.equal(Number((await remember(prefix)).widthMm), 45);
  await prisma.product.update({ where: { id: reversed.id }, data: { marketplaceMode: "AUTO" } });
  const parallel = await Promise.allSettled(Array.from({ length: 4 }, () => apply("ozon", base)));
  for (const result of parallel) { if (result.status === "rejected") throw result.reason; }
  assert.equal(await prisma.product.count({ where: { sku: prefix } }), 1);

  await prisma.product.update({ where: { id: reversed.id }, data: { status: "PUBLISHED", stock: 9, madeToOrder: true, title: "Local SEO" } });
  await apply("wb", { ...wb, sku: `${prefix}-different-seller-sku`, price: 900 });
  const preserved = await remember(prefix);
  assert.equal(Number(preserved.basePrice), 150); assert.equal(preserved.stock, 9); assert.equal(preserved.title, "Local SEO"); assert.equal(preserved.status, "PUBLISHED");
  assert.equal(await prisma.marketplaceIdentity.count({ where: { key: `sku:${prefix}-DIFFERENT-SELLER-SKU`, productId: reversed.id } }), 1);

  const legacy = await prisma.product.create({ data: { name: `${prefix} legacy`, sku: `  ${prefix}-legacy  `, slug: `${prefix}-legacy`, basePrice: 10, stock: 4 } });
  productIds.push(legacy.id);
  await apply("ozon", { ...base, externalId: "102", sku: `${prefix.toLowerCase()}-legacy`, barcodes: [`${prefix}-legacy-barcode`], name: `${prefix} legacy updated` });
  assert.equal((await prisma.marketplaceListing.findUniqueOrThrow({ where: { provider_accountId_externalId: { provider: "ozon", accountId, externalId: "102" } } })).productId, legacy.id);
  assert.equal(await prisma.product.count({ where: { name: `${prefix} legacy updated` } }), 1);

  const conflict = { ...base, externalId: "103", sku: prefix, barcodes: [`${prefix}-legacy-barcode`] };
  await apply("ozon", conflict);
  const pending = await prisma.marketplaceListing.findUniqueOrThrow({ where: { provider_accountId_externalId: { provider: "ozon", accountId, externalId: "103" } } });
  assert.equal(pending.conflict, "identifiers"); assert.equal(pending.productId, null);
  await assert.rejects(prisma.$transaction(async (tx) => { await marketplaceLock(tx); await mapListing(tx, pending.id, legacy.id); }));
  await apply("ozon", { ...base, externalId: "104", sku: `${prefix}-unrelated`, barcodes: [], name: preserved.name });
  const sameName = await prisma.marketplaceListing.findUniqueOrThrow({ where: { provider_accountId_externalId: { provider: "ozon", accountId, externalId: "104" } } });
  assert.equal(sameName.conflict, "name"); assert.equal(sameName.productId, null);
  // A second listing of the same provider cannot hijack an existing linkage.
  await apply("ozon", { ...base, externalId: "105" });
  assert.equal((await prisma.marketplaceListing.findUniqueOrThrow({ where: { provider_accountId_externalId: { provider: "ozon", accountId, externalId: "105" } } })).conflict, "multiple");

  const manual = { ...base, externalId: "202", sku: `${prefix}-manual-map`, barcodes: [], name: `${prefix} legacy updated`, issue: "prices" };
  await apply("wb", manual);
  const manualListing = await prisma.marketplaceListing.findUniqueOrThrow({ where: { provider_accountId_externalId: { provider: "wb", accountId, externalId: "202" } } });
  assert.equal(manualListing.conflict, "prices");
  await prisma.$transaction(async (tx) => { await marketplaceLock(tx); await mapListing(tx, manualListing.id, legacy.id); });
  assert.equal((await prisma.marketplaceListing.findUniqueOrThrow({ where: { id: manualListing.id } })).productId, legacy.id);
  await apply("wb", { ...manual, issue: "prices" });
  await prisma.$transaction(async (tx) => { await marketplaceLock(tx); await mapListing(tx, manualListing.id, legacy.id); });
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: legacy.id } })).marketplaceMode, "SITE");
  await apply("wb", { ...manual, issue: "prices", price: 999 });
  assert.equal((await prisma.marketplaceListing.findUniqueOrThrow({ where: { id: manualListing.id } })).conflict, null);
  assert.equal(Number((await prisma.product.findUniqueOrThrow({ where: { id: legacy.id } })).basePrice), 150);

  await prisma.product.update({ where: { id: reversed.id }, data: { marketplaceMode: "SITE", name: "Manual name", basePrice: 777, shippingWeightG: 123, shippingLengthMm: null, widthMm: 99 } });
  await apply("ozon", { ...measured, price: 180 });
  assert.equal((await remember(prefix)).name, "Manual name"); assert.equal(Number((await remember(prefix)).basePrice), 777);
  assert.equal((await remember(prefix)).shippingWeightG, 123); assert.equal(Number((await remember(prefix)).widthMm), 99);
  assert.equal((await remember(prefix)).shippingLengthMm, null); // Do not complete a partially manual parcel using unrelated Ozon dimensions.
  await assert.rejects(prisma.$transaction((tx) => guardProductWrite(tx, ` ${prefix.toLowerCase()} `)), /duplicate-sku/);

  // Exercise the real queue, leases, page checkpoints and worker with mock HTTP.
  await prisma.siteSetting.upsert({ where: { key: connectionKey("ozon") }, create: { key: connectionKey("ozon"), group: "integrations", value: { accountId, clientId: "123", name: "Local fixture", secret: encryptSecret("fixture-api-key", connectionKey("ozon")), checkedAt: new Date().toISOString() } }, update: { value: { accountId, clientId: "123", name: "Local fixture", secret: encryptSecret("fixture-api-key", connectionKey("ozon")), checkedAt: new Date().toISOString() } } });
  let ids: string[] = [];
  globalThis.fetch = async (input, options) => {
    const path = new URL(String(input)).pathname;
    const body = JSON.parse(String(options?.body || "{}"));
    assert.equal(options?.redirect, "error");
    if (path === "/v3/product/list") {
      ids = body.last_id ? ["420"] : Array.from({ length: 20 }, (_, index) => String(400 + index));
      return Response.json({ result: { items: ids.map((id) => ({ product_id: Number(id), offer_id: `${prefix}-worker-${id}` })), last_id: body.last_id ? "end" : "next", total: 21 } });
    }
    if (path === "/v3/product/info/list") return Response.json({ items: ids.map((id) => ({ id: Number(id), offer_id: `${prefix}-worker-${id}`, name: `${prefix} worker ${id}`, barcodes: [], images: [] })) });
    if (path === "/v5/product/info/prices") return Response.json({ items: ids.map((id) => ({ product_id: Number(id), price: { price: "321.50", old_price: "400", currency_code: "RUB" } })) });
    if (path === "/v4/product/info/attributes") return Response.json({ result: ids.map((id) => ({ id: Number(id), depth: 190, width: 55, height: 70, dimension_unit: "mm", weight: 85, weight_unit: "g", attributes: [] })) });
    throw new Error("Unexpected outbound request in local test");
  };
  const queued = await prisma.marketplaceSyncRun.create({ data: { provider: "ozon", accountId } }); runIds.push(queued.id);
  await assert.rejects(prisma.$transaction((tx) => guardProductWrite(tx, `${prefix}-blocked`)), /marketplace-busy/);
  const claims = await Promise.all([claimRun(), claimRun()]);
  assert.equal(claims.filter(Boolean).length, 1);
  await processRun(claims.find(Boolean)!);
  const completed = await prisma.marketplaceSyncRun.findUniqueOrThrow({ where: { id: queued.id } });
  assert.equal(completed.status, "SUCCEEDED"); assert.equal(completed.processed, 21); assert.equal(completed.created, 21); assert.equal(completed.conflicts, 0);
  const workerMeasured = await prisma.product.findUniqueOrThrow({ where: { sku: `${prefix}-WORKER-400` } });
  assert.equal(workerMeasured.shippingWeightG, 85); assert.equal(workerMeasured.shippingLengthMm, 190); assert.equal(workerMeasured.shippingWidthMm, 55); assert.equal(workerMeasured.shippingHeightMm, 70);
  assert.equal(workerMeasured.weightGrams, null); // Package weight is not the bare item.
  productIds.push(...(await prisma.product.findMany({ where: { sku: { startsWith: `${prefix}-WORKER-` } }, select: { id: true } })).map((row) => row.id));

  const stale = await prisma.marketplaceSyncRun.create({ data: { provider: "ozon", accountId, status: "RUNNING", leaseToken: "expired", leaseUntil: new Date(0), processed: 1, updated: 1 } }); runIds.push(stale.id);
  const workerListing = await prisma.marketplaceListing.findUniqueOrThrow({ where: { provider_accountId_externalId: { provider: "ozon", accountId, externalId: "400" } } });
  await prisma.marketplaceListing.update({ where: { id: workerListing.id }, data: { lastRunId: stale.id } });
  const resumed = await claimRun(); assert.equal(resumed?.id, stale.id);
  await processRun(resumed!);
  const recovered = await prisma.marketplaceSyncRun.findUniqueOrThrow({ where: { id: stale.id } });
  assert.equal(recovered.status, "SUCCEEDED"); assert.equal(recovered.processed, 21); assert.equal(recovered.created, 0); assert.equal(recovered.updated, 21);
  assert.equal(await prisma.product.count({ where: { id: { in: productIds } } }), 23);
  // Four colours are four products, not duplicates merely because titles match.
  for (const [index, label] of ["розовый", "белый", "черный", "зеленый"].entries()) {
    const colour = { ...base, externalId: `${700 + index}`, sku: `${prefix}-colour-${index}`, barcodes: [`${prefix}-colour-barcode-${index}`], name: `${prefix} same bowl title`, group: { id: "4240851203", label } };
    if (index === 0) await prisma.marketplaceListing.create({ data: { provider: "wb", accountId, externalId: colour.externalId, sellerSku: colour.sku, normalizedSku: colour.sku.toUpperCase(), barcodes: colour.barcodes, snapshot: colour, conflict: "name" } });
    assert.equal((await apply("wb", colour)).created, 1);
    assert.equal((await apply("wb", colour)).created, 0);
  }
  const colours = await prisma.product.findMany({ where: { sku: { startsWith: `${prefix}-COLOUR-` } }, orderBy: { sku: "asc" } });
  productIds.push(...colours.map(product => product.id));
  assert.equal(colours.length, 4);
  assert.equal(new Set(colours.map(product => product.groupId)).size, 1);
  assert(colours[0].groupId);
  assert.deepEqual(colours.map(product => product.groupLabel), ["розовый", "белый", "черный", "зеленый"]);
  await prisma.product.update({ where: { id: colours[0].id }, data: { groupingMode: "MANUAL", groupId: null, groupLabel: null } });
  await apply("wb", { ...base, externalId: "700", sku: `${prefix}-colour-0`, barcodes: [`${prefix}-colour-barcode-0`], name: `${prefix} same bowl title`, group: { id: "4240851203", label: "новая подпись" } });
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: colours[0].id } })).groupId, null);
  const otherAccount = `${accountId}-other`;
  await prisma.$transaction(async tx => { await marketplaceLock(tx); await applySnapshot(tx, "wb", otherAccount, { ...base, externalId: "800", sku: `${prefix}-other-colour`, barcodes: [], name: `${prefix} same bowl title`, group: { id: "4240851203", label: "синий" } }); });
  const separate = await prisma.product.findUniqueOrThrow({ where: { sku: `${prefix}-OTHER-COLOUR` } }); productIds.push(separate.id);
  assert.notEqual(separate.groupId, colours[1].groupId);
  await prisma.marketplaceListing.deleteMany({ where: { accountId: otherAccount } });
  console.log("PASS: cross-provider/order-independent identity, repeat/concurrent import, barcode aliases, legacy site SKUs, conflicts, manual protection, queue, stale lease recovery, page replay/counters, separate same-title WB colours, recovery of old name conflicts, idempotent account-scoped groups and protected manual exclusion. Mock HTTP only.");
} finally {
  globalThis.fetch = originalFetch;
  await prisma.marketplaceListing.deleteMany({ where: { accountId } });
  await prisma.marketplaceSyncRun.deleteMany({ where: { id: { in: runIds } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.productGroup.deleteMany({ where: { sourceKey: { startsWith: `wb:${accountId}` } } });
  await prisma.category.delete({ where: { id: category.id } });
  for (const [key, row] of [[POLICY_KEY, oldPolicy], [connectionKey("ozon"), oldConnection]] as const) {
    if (row) await prisma.siteSetting.upsert({ where: { key }, create: { ...row, value: row.value === null ? Prisma.JsonNull : row.value as Prisma.InputJsonValue }, update: { value: row.value === null ? Prisma.JsonNull : row.value as Prisma.InputJsonValue, group: row.group } });
    else await prisma.siteSetting.deleteMany({ where: { key } });
  }
  await prisma.$disconnect();
}
