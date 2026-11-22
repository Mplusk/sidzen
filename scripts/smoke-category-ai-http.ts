import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { encryptSecret } from "../src/lib/integration-secrets";
import { CATEGORY_AI_KEY } from "../src/lib/category-ai/config";
import { processCategoryAiJob } from "../src/lib/category-ai/worker";
const base = new URL(process.env.SMOKE_BASE_URL || "http://localhost:3101"), db = new URL(process.env.DATABASE_URL || "");
assert(["localhost", "127.0.0.1"].includes(base.hostname) && ["localhost", "127.0.0.1"].includes(db.hostname) && db.pathname === "/shop_qa");
const prefix = `qa-ai-http-${randomUUID().slice(0, 8)}`, products: string[] = [], categories: string[] = [], jar = new Map<string, string>();
const old = await prisma.siteSetting.findUnique({ where: { key: CATEGORY_AI_KEY } });
const oldLogs = (await prisma.diagnosticLog.findMany({ where: { area: "ai" }, select: { id: true } })).map(row => row.id);
const actor = await prisma.user.findUniqueOrThrow({ where: { email: "qa@example.test" } });
const config = { enabled: true, apiKey: encryptSecret("sk-http-fixture-only", CATEGORY_AI_KEY), model: "deepseek-flash", allowCreate: true, revision: randomUUID(), checkedAt: new Date().toISOString() };
const decode = (value: string) => value.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
async function request(path: string, body?: FormData, authenticated = true, origin = base.origin) {
  const response = await fetch(new URL(path, base), { method: body ? "POST" : "GET", body, redirect: "manual", headers: { ...(authenticated ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}), ...(body ? { Origin: origin } : {}) } });
  if (authenticated) for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(";")[0], at = pair.indexOf("="); jar.set(pair.slice(0, at), pair.slice(at + 1)); }
  return response;
}
async function form(path: string, containing: string) {
  const response = await request(path); assert.equal(response.status, 200);
  const html = (await response.text()).replace(/<!--[\s\S]*?-->/g, ""), markup = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(m => m[0]).find(text => text.includes(containing)); assert(markup);
  const body = new FormData();
  for (const match of markup.matchAll(/<input\b[^>]*>/g)) {
    const name = match[0].match(/name="([^"]*)"/)?.[1], value = match[0].match(/value="([^"]*)"/)?.[1] || "";
    if (name && (name.startsWith("$ACTION") || match[0].includes('type="hidden"'))) body.set(decode(name), decode(value));
  }
  return { body, html };
}
function productFields(body: FormData, sku: string, mode: string, category = "") {
  for (const [name, value] of Object.entries({ name: `${prefix} Лампа`, sku, status: "DRAFT", type: "READY", basePrice: "100", stock: "1", leadDays: "3", robots: "index,follow", categoryMode: mode, primaryCategoryId: category })) body.set(name, value);
  return body;
}
try {
  await prisma.siteSetting.upsert({ where: { key: CATEGORY_AI_KEY }, create: { key: CATEGORY_AI_KEY, group: "integrations", value: config }, update: { value: config, group: "integrations" } });
  for (let i = 0; i < 2; i++) categories.push((await prisma.category.create({ data: { name: `${prefix} Категория ${i}`, slug: `${prefix}-${i}` } })).id);
  const login = (await form("/login/", 'name="email"')).body; login.set("email", "qa@example.test"); login.set("password", "LocalGalleryQA-2026"); assert.equal((await request("/login/", login)).status, 303);
  const integrations = await form("/account/integrations/", 'name="allowCreate"');
  assert.equal(integrations.body.get("revision"), config.revision, "Expected the DeepSeek category settings form");
  assert(integrations.html.includes("DeepSeek · категории товаров")); assert(!integrations.html.includes("sk-http-fixture-only")); assert(!integrations.html.includes(config.apiKey));
  integrations.body.set("apiKey", "Bearer invalid key");
  integrations.body.set("model", "deepseek-flash");
  assert.match((await request("/account/integrations/", integrations.body, false)).headers.get("location") ?? "", /^\/login/);
  assert([400, 403, 500].includes((await request("/account/integrations/", integrations.body, true, "https://foreign.invalid")).status));
  const roles = await prisma.userRole.findMany({ where: { userId: actor.id } });
  try {
    await prisma.userRole.deleteMany({ where: { userId: actor.id } });
    assert.match((await request("/account/integrations/", integrations.body)).headers.get("location") ?? "", /forbidden/);
  } finally { await prisma.userRole.createMany({ data: roles, skipDuplicates: true }); }
  assert.match((await request("/account/integrations/", integrations.body)).headers.get("location") ?? "", /ai-invalid/);
  assert.deepEqual((await prisma.siteSetting.findUniqueOrThrow({ where: { key: CATEGORY_AI_KEY } })).value, config);
  const create = await form("/admin/products/new/", 'name="sku"'); assert(create.html.includes("Автоматически · DeepSeek"));
  const sku = `${prefix}-sku`, body = productFields(create.body, sku, "AI");
  assert.match((await request("/admin/products/new/", body, false)).headers.get("location") ?? "", /^\/login/);
  assert.equal(await prisma.product.count({ where: { sku } }), 0);
  const saved = await request("/admin/products/new/", body); assert.equal(saved.status, 303);
  const product = await prisma.product.findUniqueOrThrow({ where: { sku } }); products.push(product.id);
  assert.equal(product.categoryMode, "AI"); assert.equal(product.status, "DRAFT");
  assert.equal((await prisma.productCategoryAiJob.findUniqueOrThrow({ where: { productId: product.id } })).status, "PENDING");
  assert.equal(await prisma.productCategory.count({ where: { productId: product.id } }), 0);
  const transport: typeof fetch = async url => { assert.equal(String(url), "https://api.deepseek.com/chat/completions"); return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ kind: "existing", categoryId: categories[0] }) } }] }); };
  assert(await processCategoryAiJob(transport));
  const path = `/admin/products/${product.id}/`, edit = await form(path, 'name="sku"');
  assert(edit.html.includes("Категория определена DeepSeek"));
  assert.equal((await prisma.productCategory.findFirstOrThrow({ where: { productId: product.id, isPrimary: true } })).categoryId, categories[0]);
  assert(edit.body.get("productVersion"));
  // Simulate a sale after the administrator opened the form: an old stock value must not overwrite it.
  // Keep the timestamp identical to cover two writes landing in the same millisecond.
  await prisma.product.update({ where: { id: product.id }, data: { stock: 0, updatedAt: new Date(String(edit.body.get("productVersion"))) } });
  const stale = productFields(edit.body, sku, "MANUAL", categories[1]);
  assert.match((await request(path, stale)).headers.get("location") ?? "", /error=stale/);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock, 0);
  // A list price edit must also invalidate this form even within the same millisecond.
  const priceForm = (await form(path, 'name="sku"')).body;
  assert(priceForm.get("originalBasePrice") !== null && priceForm.get("originalOldPrice") !== null);
  await prisma.product.update({ where: { id: product.id }, data: { basePrice: 175, oldPrice: 200, updatedAt: new Date(String(priceForm.get("productVersion"))) } });
  const stalePrice = productFields(priceForm, sku, "MANUAL", categories[1]);
  assert.match((await request(path, stalePrice)).headers.get("location") ?? "", /error=stale/);
  const afterPrice = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  assert.equal(Number(afterPrice.basePrice), 175); assert.equal(Number(afterPrice.oldPrice), 200);
  await prisma.product.update({ where: { id: product.id }, data: { basePrice: 100, oldPrice: null } });
  const noVersion = productFields((await form(path, 'name="sku"')).body, sku, "MANUAL", categories[1]);
  noVersion.delete("productVersion");
  assert.match((await request(path, noVersion)).headers.get("location") ?? "", /error=stale/);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock, 0);
  await prisma.product.update({ where: { id: product.id }, data: { stock: 1, reservedStock: 1 } });
  const belowReservation = productFields((await form(path, 'name="sku"')).body, sku, "MANUAL", categories[1]);
  belowReservation.set("stock", "0");
  assert.match((await request(path, belowReservation)).headers.get("location") ?? "", /error=reserved-stock/);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).stock, 1);
  await prisma.product.update({ where: { id: product.id }, data: { reservedStock: 0 } });
  const manual = productFields((await form(path, 'name="sku"')).body, sku, "MANUAL", categories[1]); assert.equal((await request(path, manual)).status, 303);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).categoryMode, "MANUAL");
  assert.equal((await prisma.productCategory.findFirstOrThrow({ where: { productId: product.id, isPrimary: true } })).categoryId, categories[1]);
  assert.equal(await processCategoryAiJob(transport), false);
  const repeat = productFields((await form(path, 'name="sku"')).body, sku, "AI", categories[1]); assert.equal((await request(path, repeat)).status, 303);
  assert.equal((await prisma.productCategoryAiJob.findUniqueOrThrow({ where: { productId: product.id } })).status, "PENDING"); assert(await processCategoryAiJob(transport));
  assert.equal((await prisma.productCategory.findFirstOrThrow({ where: { productId: product.id, isPrimary: true } })).categoryId, categories[0]);
  const logs = await request("/account/logs/?area=ai"); assert.equal(logs.status, 200); assert((await logs.text()).includes("DeepSeek определил категорию товара"));
  console.log("PASS: administrator DeepSeek form/key redaction/auth/role/CSRF/validation, automatic new product queue, real fixture worker result, manual correction protection, explicit recategorization and AI logs over HTTP. No real DeepSeek requests.");
} finally {
  await prisma.auditLog.deleteMany({ where: { entityId: { in: products } } });
  await prisma.product.deleteMany({ where: { id: { in: products } } });
  await prisma.category.deleteMany({ where: { id: { in: categories } } });
  await prisma.diagnosticLog.deleteMany({ where: { area: "ai", id: { notIn: oldLogs } } });
  if (old) await prisma.siteSetting.upsert({ where: { key: CATEGORY_AI_KEY }, create: { key: old.key, value: old.value!, group: old.group }, update: { value: old.value!, group: old.group } });
  else await prisma.siteSetting.deleteMany({ where: { key: CATEGORY_AI_KEY } });
  await prisma.$disconnect();
}
