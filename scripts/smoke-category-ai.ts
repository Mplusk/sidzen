// Real PostgreSQL queue/transactions, fixture DeepSeek transport only.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { encryptSecret } from "../src/lib/integration-secrets";
import { CATEGORY_AI_KEY, queueCategoryAi } from "../src/lib/category-ai/config";
import { claimCategoryAiJob, processCategoryAiJob } from "../src/lib/category-ai/worker";
import { applySnapshot, marketplaceLock } from "../src/lib/marketplaces/sync";

const db = new URL(process.env.DATABASE_URL || "");
assert(["localhost", "127.0.0.1"].includes(db.hostname) && db.pathname === "/shop_qa", "Only local disposable QA database");
assert.equal(await prisma.productCategoryAiJob.count({ where: { status: { in: ["PENDING", "RUNNING"] } } }), 0, "No unrelated QA jobs may be touched");
const prefix = `qa-ai-${randomUUID().slice(0, 8)}`, products: string[] = [], categories: string[] = [], runs: string[] = [];
const original = await prisma.siteSetting.findUnique({ where: { key: CATEGORY_AI_KEY } });
const oldLogs = (await prisma.diagnosticLog.findMany({ where: { area: "ai" }, select: { id: true } })).map(row => row.id);
let config = { enabled: true, apiKey: encryptSecret("sk-fixture-not-real", CATEGORY_AI_KEY), model: "deepseek-flash", allowCreate: true, revision: randomUUID(), checkedAt: new Date().toISOString() };
const saveConfig = async () => prisma.siteSetting.upsert({ where: { key: CATEGORY_AI_KEY }, create: { key: CATEGORY_AI_KEY, group: "integrations", value: config }, update: { value: config, group: "integrations" } });
async function create(name = `${prefix} Лампа`) {
  const sku = `${prefix}-${products.length}`;
  const product = await prisma.product.create({ data: { sku, slug: sku, name, basePrice: 100, categoryMode: "AI" } }); products.push(product.id);
  await prisma.$transaction(async tx => { await marketplaceLock(tx); await queueCategoryAi(tx, product.id, "AI"); }); return product;
}
const job = (id: string) => prisma.productCategoryAiJob.findUniqueOrThrow({ where: { productId: id } });
const primary = async (id: string) => (await prisma.productCategory.findFirst({ where: { productId: id, isPrimary: true } }))?.categoryId;
const answer = (value: unknown) => Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }] });
let calls = 0;
try {
  await saveConfig();
  const category = await prisma.category.create({ data: { name: `${prefix} Настольные лампы`, slug: `${prefix}-lamps` } }); categories.push(category.id);
  const transport: typeof fetch = async (url, options) => {
    calls++; assert.equal(String(url), "https://api.deepseek.com/chat/completions");
    const body = JSON.parse(String(options?.body)); assert.equal(body.response_format.type, "json_object");
    const input = JSON.parse(body.messages[1].content);
    assert.deepEqual(Object.keys(input.product), ["name", "shortDescription", "description"]);
    return answer({ kind: "existing", categoryId: category.id });
  };
  const first = await create();
  assert.equal((await job(first.id)).status, "PENDING");
  const processed = await Promise.all([processCategoryAiJob(transport), processCategoryAiJob(transport)]);
  assert.equal(processed.filter(Boolean).length, 1); assert.equal(calls, 1); assert.equal(await primary(first.id), category.id); assert.equal((await job(first.id)).status, "DONE");
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: first.id } })).status, "DRAFT");
  const newName = `${prefix} Подставки`;
  const second = await create(`${prefix} Подставка`);
  assert(await processCategoryAiJob(async () => answer({ kind: "new", name: newName })));
  const createdCategory = await prisma.category.findUniqueOrThrow({ where: { id: (await primary(second.id))! } }); categories.push(createdCategory.id);
  assert.equal(createdCategory.name, newName);
  const third = await create();
  assert(await processCategoryAiJob(async () => answer({ kind: "new", name: newName.toUpperCase() })));
  assert.equal(await primary(third.id), createdCategory.id);
  assert.equal(await prisma.category.count({ where: { name: { equals: newName, mode: "insensitive" } } }), 1);
  // Manual selection while the provider is answering cancels the lease and
  // MUST NOT create the proposed category or overwrite the editor's choice.
  const manual = await create();
  assert.equal(await processCategoryAiJob(async () => {
    await prisma.$transaction(async tx => { await marketplaceLock(tx); await tx.product.update({ where: { id: manual.id }, data: { categoryMode: "MANUAL", categories: { create: { categoryId: category.id, isPrimary: true } } } }); await queueCategoryAi(tx, manual.id, "MANUAL"); });
    return answer({ kind: "new", name: `${prefix} Не создавать` });
  }), false);
  assert.equal(await primary(manual.id), category.id); assert.equal((await job(manual.id)).status, "CANCELED");
  assert.equal(await prisma.category.count({ where: { name: `${prefix} Не создавать` } }), 0);
  // A malformed model response cannot mutate categories or retry forever.
  const invalid = await create();
  assert.equal(await processCategoryAiJob(async () => answer({ kind: "existing", categoryId: "fabricated" })), false);
  assert.equal((await job(invalid.id)).status, "FAILED"); assert.equal((await job(invalid.id)).errorCode, "response"); assert.equal(await primary(invalid.id), undefined);
  // Provider temporary failures retry later, at most three attempts.
  const temporary = await create();
  for (let attempt = 1; attempt <= 3; attempt++) {
    await prisma.productCategoryAiJob.update({ where: { productId: temporary.id }, data: { availableAt: new Date(0) } });
    assert.equal(await processCategoryAiJob(async () => Response.json({ private: "never-log-this" }, { status: 503 })), false);
    assert.equal((await job(temporary.id)).attempts, attempt);
    assert.equal((await job(temporary.id)).status, attempt < 3 ? "PENDING" : "FAILED");
  }
  // Changed text/config discards stale AI results and schedules fresh input.
  const changed = await create();
  assert.equal(await processCategoryAiJob(async () => { await prisma.product.update({ where: { id: changed.id }, data: { name: `${prefix} Другая лампа` } }); return answer({ kind: "existing", categoryId: category.id }); }), false);
  assert.equal((await job(changed.id)).status, "PENDING"); assert.equal(await primary(changed.id), undefined);
  assert.equal(await processCategoryAiJob(async () => { config = { ...config, revision: randomUUID() }; await saveConfig(); return answer({ kind: "existing", categoryId: category.id }); }), false);
  assert.equal((await job(changed.id)).status, "PENDING"); assert(await processCategoryAiJob(transport));
  // A crashed worker's lease is reclaimed without running a fourth request.
  const crashed = await create();
  const lease = await claimCategoryAiJob(); assert.equal(lease?.productId, crashed.id);
  await prisma.productCategoryAiJob.update({ where: { productId: crashed.id }, data: { leaseUntil: new Date(0) } });
  assert(await processCategoryAiJob(transport)); assert.equal((await job(crashed.id)).attempts, 2);
  const exhausted = await create();
  await prisma.productCategoryAiJob.update({ where: { productId: exhausted.id }, data: { status: "RUNNING", attempts: 3, leaseUntil: new Date(0) } });
  assert.equal(await processCategoryAiJob(transport), false); assert.equal((await job(exhausted.id)).status, "FAILED");
  // The real marketplace pipeline queues NEW products only. Reimports of a
  // manually corrected existing product never alter the selected category.
  const snapshot = { externalId: "1", sku: `${prefix}-IMPORT`, name: `${prefix} Импорт`, price: 100, oldPrice: null, barcodes: [], description: "PLA", specifications: {}, images: [], issue: null };
  await prisma.$transaction(async tx => { await marketplaceLock(tx); assert.equal((await applySnapshot(tx, "wb", prefix, snapshot)).created, 1); });
  const imported = await prisma.product.findUniqueOrThrow({ where: { sku: snapshot.sku.toUpperCase() } }); products.push(imported.id);
  assert.equal(imported.categoryMode, "AI"); assert.equal((await job(imported.id)).status, "PENDING");
  const run = await prisma.marketplaceSyncRun.create({ data: { provider: "wb", accountId: prefix } }); runs.push(run.id);
  assert.equal(await processCategoryAiJob(transport), false); assert.equal((await job(imported.id)).status, "PENDING");
  await prisma.marketplaceSyncRun.delete({ where: { id: run.id } }); runs.pop();
  assert(await processCategoryAiJob(transport));
  await prisma.$transaction(async tx => { await marketplaceLock(tx); await tx.product.update({ where: { id: imported.id }, data: { categoryMode: "MANUAL", categories: { deleteMany: {}, create: { categoryId: createdCategory.id, isPrimary: true } } } }); await queueCategoryAi(tx, imported.id, "MANUAL"); await applySnapshot(tx, "wb", prefix, { ...snapshot, name: `${prefix} Новое описание` }); });
  assert.equal(await primary(imported.id), createdCategory.id); assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: imported.id } })).categoryMode, "MANUAL");
  config = { ...config, enabled: false }; await saveConfig();
  const paused = await create(); assert.equal(await processCategoryAiJob(transport), false); assert.equal(await prisma.productCategoryAiJob.count({ where: { productId: paused.id } }), 0);
  const logs = await prisma.diagnosticLog.findMany({ where: { area: "ai", id: { notIn: oldLogs } } });
  assert(logs.some(log => log.code === "category-ai.ok")); assert(logs.some(log => log.code === "category-ai.failed"));
  assert(!JSON.stringify(logs).includes("never-log-this")); assert(!JSON.stringify(logs).includes("sk-fixture"));
  console.log("PASS: DeepSeek JSON categorization, durable queue, existing/new/deduplicated categories, single lease, crash recovery, bounded retries, stale-input/config rejection, manual override races, imports, disabled integration and sanitized logs. Fixture transport only; no real AI requests.");
} finally {
  await prisma.marketplaceSyncRun.deleteMany({ where: { id: { in: runs } } });
  await prisma.marketplaceListing.deleteMany({ where: { accountId: prefix } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: products }, action: "product.category.ai" } });
  await prisma.product.deleteMany({ where: { id: { in: products } } });
  await prisma.category.deleteMany({ where: { id: { in: categories } } });
  await prisma.diagnosticLog.deleteMany({ where: { area: "ai", id: { notIn: oldLogs } } });
  if (original) await prisma.siteSetting.upsert({ where: { key: CATEGORY_AI_KEY }, create: { key: original.key, value: original.value!, group: original.group }, update: { value: original.value!, group: original.group } });
  else await prisma.siteSetting.deleteMany({ where: { key: CATEGORY_AI_KEY } });
  await prisma.$disconnect();
}
