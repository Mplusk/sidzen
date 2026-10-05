// No provider calls: draft settings + local synthetic fiscal records only.
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { PrismaClient, Prisma } from "@prisma/client";
import { encryptSecret, decryptSecret } from "../src/lib/integration-secrets";
import { CLOUD_SETTING, RECEIPT_PURPOSE } from "../src/lib/cloudkassir/config";
import { createFiscalPayload } from "../src/lib/cloudkassir/payload";
const base = new URL(process.env.SMOKE_BASE_URL || "http://localhost:3101"), database = new URL(process.env.DATABASE_URL || "");
assert(["localhost", "127.0.0.1"].includes(base.hostname) && ["localhost", "127.0.0.1"].includes(database.hostname) && database.pathname === "/shop_qa");
const db = new PrismaClient(), jar = new Map<string, string>();
const old = await db.siteSetting.findUnique({ where: { key: CLOUD_SETTING } });
const beforeAudit = (await db.auditLog.findMany({ select: { id: true } })).map(row => row.id);
const ids: string[] = []; const secret = "synthetic-cloud-secret-not-public", settings = "/account/integrations/";
async function request(path: string, body?: FormData, authenticated = true, origin = base.origin) {
  const response = await fetch(new URL(path, base), { method: body ? "POST" : "GET", redirect: "manual", headers: { ...(authenticated ? { Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; ") } : {}), ...(body ? { Origin: origin } : {}) }, body });
  if (authenticated) for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(";")[0], i = pair.indexOf("="); jar.set(pair.slice(0, i), pair.slice(i + 1)); }
  return response;
}
async function form(path: string, contains: string) {
  const response = await request(path); assert.equal(response.status, 200);
  const markup = [...(await response.text()).matchAll(/<form\b[\s\S]*?<\/form>/g)].map(row => row[0]).find(row => row.includes(contains)); assert(markup, `Missing form ${contains}`);
  const body = new FormData();
  for (const row of markup.matchAll(/<input\b[^>]*>/g)) { const name = row[0].match(/name="([^"]*)"/)?.[1], value = row[0].match(/value="([^"]*)"/)?.[1] || ""; if (name && (name.startsWith("$ACTION") || row[0].includes('type="hidden"'))) body.set(name.replace(/&amp;/g, "&"), value.replace(/&amp;/g, "&")); }
  return body;
}
try {
  assert.match((await request(settings)).headers.get("location")!, /login/);
  const login = await form("/login/", 'name="email"'); login.set("email", "qa@example.test"); login.set("password", "LocalGalleryQA-2026"); assert.equal((await request("/login/", login)).headers.get("location"), "/account/");
  const cloud = await form(settings, 'name="publicId"');
  for (const [key, value] of Object.entries({ publicId: "qa-only-terminal", apiSecret: secret, inn: "7707083893", deviceNumber: "12345", fiscalNumber: "9999078900005430", taxRegime: "osn", vat: "22" })) cloud.set(key, value);
  assert.match((await request(settings, cloud, false)).headers.get("location")!, /login/);
  assert((await request(settings, cloud, true, "https://foreign.invalid")).status >= 400);
  assert.match((await request(settings, cloud)).headers.get("location")!, /cloud-saved/);
  const stored = await db.siteSetting.findUniqueOrThrow({ where: { key: CLOUD_SETTING } }); const config = stored.value as Prisma.JsonObject;
  assert.equal(config.taxRegime, "ausn_income"); assert.equal(config.vat, "none"); assert.equal(config.enabled, false); assert.equal(config.checkedAt, undefined);
  assert.equal(decryptSecret(String(config.apiSecret), CLOUD_SETTING), secret);
  const markup = await (await request(settings)).text(); assert(markup.includes("CloudKassir · онлайн-касса")); assert(!markup.includes(secret) && !markup.includes(String(config.apiSecret)));
  cloud.set("apiSecret", ""); assert.match((await request(settings, cloud)).headers.get("location")!, /cloud-saved/);
  const retained = (await db.siteSetting.findUniqueOrThrow({ where: { key: CLOUD_SETTING } })).value as Prisma.JsonObject;
  assert.equal(decryptSecret(String(retained.apiSecret), CLOUD_SETTING), secret);
  cloud.set("enabled", "on"); assert.match((await request(settings, cloud)).headers.get("location")!, /cloud-incomplete/); cloud.delete("enabled");
  const user = await db.user.findUniqueOrThrow({ where: { email: "qa@example.test" } });
  const order = await db.order.create({ data: { number: `FISCALHTTP-${randomUUID().slice(0, 8)}`, userId: user.id, status: "PAID", customerName: "Synthetic buyer", customerEmail: "fixture@example.test", customerPhone: "+79990000000", subtotal: 150, total: 150, deliveryPrice: 0, items: { create: { productName: "Synthetic item", sku: "QA-ONLY", quantity: 3, unitPrice: 50, totalPrice: 150 } }, payment: { create: { provider: "tochka", amount: 150, status: "PAID" } } }, include: { items: true } }); ids.push(order.id);
  const id = randomUUID(), payload = createFiscalPayload(order, "7707083893", id);
  await db.fiscalReceipt.create({ data: { id, orderId: order.id, publicId: "qa-only-terminal", inn: "7707083893", amount: 150, kind: "PREPAYMENT", status: "QUEUED", externalId: "qa-only-receipt", firstAttemptAt: new Date(), request: encryptSecret(JSON.stringify(payload), `${RECEIPT_PURPOSE}:${id}`) } });
  const callback = new URLSearchParams({ Id: "qa-only-receipt", InvoiceId: id, Inn: "7707083893", Type: "Income", Amount: "150", Receipt: JSON.stringify(payload.CustomerReceipt), Url: "https://receipts.ru/qa-only-receipt", DocumentNumber: "123", FiscalSign: "123", FiscalNumber: "9999078900005430", RegNumber: "123", DateTime: new Date().toISOString() }).toString();
  const webhook = (body: string, signature: string) => fetch(new URL("/api/fiscal/cloudkassir/", base), { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-HMAC": signature }, body });
  assert.equal((await webhook(callback, "wrong")).status, 401);
  const signature = createHmac("sha256", secret).update(callback).digest("base64"); assert.equal((await webhook(callback, signature)).status, 200); assert.equal((await webhook(callback, signature)).status, 200);
  assert.equal((await db.fiscalReceipt.findUniqueOrThrow({ where: { id } })).status, "PROCESSED");
  assert.equal((await webhook("x".repeat(65537), "wrong")).status, 413);
  const path = `/admin/orders/${order.number}/`, status = await form(path, 'name="status"'); status.set("status", "DELIVERED"); status.set("note", "");
  assert.match((await request(path, status)).headers.get("location")!, /fiscal-status/); assert.equal(await db.fiscalReceipt.count({ where: { orderId: order.id, kind: "SETTLEMENT" } }), 0);
  status.set("deliveryConfirmed", "on"); assert.match((await request(path, status)).headers.get("location")!, /saved=1/);
  assert.equal(await db.fiscalReceipt.count({ where: { orderId: order.id, kind: "SETTLEMENT" } }), 1);
  assert.match((await request(path, status)).headers.get("location")!, /saved=1/); assert.equal(await db.fiscalReceipt.count({ where: { orderId: order.id } }), 2);
  const deletion = await form(path, "Да, удалить заказ"); assert.match((await request(path, deletion)).headers.get("location")!, /fiscal-history/); assert(await db.order.findUnique({ where: { id: order.id } }));
  status.set("status", "SHIPPED"); assert.match((await request(path, status)).headers.get("location")!, /fiscal-status/); status.set("status", "DELIVERED");
  const deleteMarkup = await (await request(path)).text(); assert(!deleteMarkup.includes("fixture@example.test\",\"CalculationPlace"));
  assert(deleteMarkup.includes("Кассовые чеки") && deleteMarkup.includes("Предоплата 100%"));
  const buyer = await (await request(`/account/orders/${order.number}/`)).text(); assert(buyer.includes("Открыть чек") && !buyer.includes("InvoiceId:") && !buyer.includes("API Secret"));
  assert.equal((await request(`/checkout/success/${order.number}/`, undefined, false)).status, 404);
  const roles = await db.userRole.findMany({ where: { userId: user.id } });
  try { await db.userRole.deleteMany({ where: { userId: user.id } }); assert.match((await request(settings, cloud)).headers.get("location")!, /forbidden/); assert.match((await request(path, status)).headers.get("location")!, /forbidden/); } finally { await db.userRole.createMany({ data: roles, skipDuplicates: true }); }
  console.log("PASS CloudKassir HTTP: admin-only / CSRF, encrypted hidden retained secret, fixed AUSN / no VAT, fail-closed enablement, signed idempotent webhook, handover confirmation / no duplicate settlement, buyer receipt privacy, order ownership. No real bank or cashbox calls.");
} finally {
  await db.fiscalReceipt.deleteMany({ where: { orderId: { in: ids } } }); await db.order.deleteMany({ where: { id: { in: ids } } });
  await db.auditLog.deleteMany({ where: { id: { notIn: beforeAudit } } });
  if (old) await db.siteSetting.upsert({ where: { key: CLOUD_SETTING }, create: { ...old, value: old.value ?? Prisma.JsonNull }, update: { value: old.value ?? Prisma.JsonNull } }); else await db.siteSetting.deleteMany({ where: { key: CLOUD_SETTING } });
  await db.$disconnect();
}
