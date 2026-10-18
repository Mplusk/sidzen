// Disposable localhost shop_qa only. No external APIs or real visitor data.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { monitoringCutoff, monitoringDay } from "../src/lib/monitoring-policy";
import { pruneMonitoring } from "../src/lib/monitoring";
const base = new URL(process.env.SMOKE_BASE_URL || "http://localhost:3101"), db = new URL(process.env.DATABASE_URL || "");
assert(["localhost", "127.0.0.1"].includes(base.hostname) && ["localhost", "127.0.0.1"].includes(db.hostname) && db.pathname === "/shop_qa");
const prefix = `qa-aggregate-${randomUUID()}`, sessions: string[] = [];
let buyerId = "", productId = "", categoryId = "";
const original = await prisma.monitoringCounter.findMany();
const audits = (await prisma.auditLog.findMany({ where: { action: "monitoring.clear" }, select: { id: true } })).map(row => row.id);
async function get(path: string, token = "") { return fetch(new URL(path, base), { redirect: "manual", headers: token ? { Cookie: `3dp_session=${token}` } : {} }); }
async function post(path: string, body: string | FormData, token = "", extra: Record<string, string> = {}) {
  return fetch(new URL(path, base), { method: "POST", redirect: "manual", body, headers: { Origin: body instanceof FormData ? base.origin : process.env.NEXT_PUBLIC_SITE_URL || base.origin, ...(typeof body === "string" ? { "Content-Type": "application/json" } : {}), ...(token ? { Cookie: `3dp_session=${token}; sidzen_statistics=obsolete` } : {}), ...extra } });
}
async function session(userId: string) {
  const token = randomUUID(); sessions.push((await prisma.session.create({ data: { userId, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 600000) } })).id); return token;
}
const count = async (path: string) => (await prisma.monitoringCounter.findMany({ where: { path } })).reduce((sum, row) => sum + row.views, 0n);
try {
  await prisma.monitoringCounter.deleteMany();
  const finance = [await prisma.order.count(), await prisma.user.count()];
  buyerId = (await prisma.user.create({ data: { email: `${prefix}@example.test`, name: "Synthetic visitor", passwordHash: "fixture" } })).id;
  const buyer = await session(buyerId), admin = await session((await prisma.user.findUniqueOrThrow({ where: { email: "qa@example.test" } })).id);
  categoryId = (await prisma.category.create({ data: { name: prefix, slug: prefix, visible: true } })).id;
  productId = (await prisma.product.create({ data: { name: prefix, sku: prefix, slug: prefix, status: "PUBLISHED", basePrice: 10, categories: { create: { categoryId, isPrimary: true } } } })).id;
  const productPath = `/catalog/${prefix}/${prefix}/`;
  assert.match((await get("/account/monitoring/")).headers.get("location") || "", /login/);
  assert.match((await get("/account/monitoring/", buyer)).headers.get("location") || "", /forbidden/);
  const legacy = await prisma.$queryRaw<Array<{ visits: bigint; pages: bigint; consents: bigint }>>`SELECT (SELECT count(*) FROM "MonitoringVisit") AS visits, (SELECT count(*) FROM "MonitoringPage") AS pages, (SELECT count(*) FROM "MonitoringConsent") AS consents`;
  assert.deepEqual(legacy, [{ visits: 0n, pages: 0n, consents: 0n }]);
  await assert.rejects(prisma.$executeRaw`INSERT INTO "MonitoringConsent" ("visitorHash", "createdAt", "version", "expiresAt") VALUES ('qa-retired', CURRENT_TIMESTAMP, 'fixture', CURRENT_TIMESTAMP)`, /Personal monitoring is retired/);
  assert.equal((await post("/api/monitoring/", JSON.stringify({ type: "view", visit: randomUUID(), page: randomUUID(), path: "/catalog/" }))).status, 410);
  const retiredConsent = await post("/api/monitoring/consent/?choice=allow", "{}");
  assert.equal(retiredConsent.status, 204); assert.match(retiredConsent.headers.get("set-cookie") || "", /^sidzen_statistics=;.*Max-Age=0/);
  assert.equal((await post("/api/page-views/", '{"path":"/catalog/"}', "", { Origin: "https://foreign.invalid" })).status, 403);
  const privacyHeaders: Array<Record<string, string>> = [{ DNT: "1" }, { "Sec-GPC": "1" }, { "User-Agent": "Googlebot" }];
  for (const headers of privacyHeaders) assert.equal((await post("/api/page-views/", '{"path":"/catalog/"}', "", headers)).status, 204);
  assert.equal(await count("/catalog/"), 0n);
  for (const path of ["/account/orders/", "/checkout/", "/cart/", "/catalog/?q=Иван", "/catalog/unknown-person/"]) assert.equal((await post("/api/page-views/", JSON.stringify({ path }))).status, 204);
  assert.equal(await prisma.monitoringCounter.count(), 0);
  for (const body of ['{"path":"/catalog/","userId":"private"}', '{"path":"/catalog/","ip":"8.8.8.8"}', '{"path":"/catalog/","seconds":5}', '{"path":"/catalog/","visit":"private"}', "not-json"]) assert.equal((await post("/api/page-views/", body)).status, 400);
  assert.equal((await post("/api/page-views/", "x".repeat(1500))).status, 413);
  assert.equal((await post("/api/page-views/", "{}", "", { "Content-Type": "text/plain" })).status, 415);
  const first = await post("/api/page-views/", '{"path":"/catalog/"}'); assert.equal(first.status, 204); assert.equal(first.headers.get("set-cookie"), null);
  const results = await Promise.all(Array.from({ length: 20 }, () => post("/api/page-views/", '{"path":"/catalog/"}'))); assert(results.every(response => response.status === 204));
  assert.equal(await count("/catalog/"), 21n, "Atomic total, not unique visitors");
  for (const token of ["", buyer, admin]) assert.equal((await post("/api/page-views/", JSON.stringify({ path: productPath }), token, { "X-Sidzen-Client-IP": "8.8.8.8", Referer: "https://foreign.invalid/private" })).status, 204);
  assert.equal(await count(productPath), 3n, "No account-based segmentation");
  const saved = await prisma.monitoringCounter.findFirstOrThrow({ where: { path: productPath } });
  assert.deepEqual(Object.keys(saved).sort(), ["day", "path", "productId", "views"]); assert.equal(saved.productId, productId);
  const boundary = monitoringCutoff(30), expired = new Date(boundary.getTime() - 86400000);
  await prisma.monitoringCounter.createMany({ data: [{ day: expired, path: "/faq/", views: 10n }, { day: boundary, path: "/faq/", views: 2n }] });
  await pruneMonitoring(); assert.equal((await prisma.monitoringCounter.findMany({ where: { path: "/faq/" } })).length, 1);
  await prisma.monitoringCounter.create({ data: { day: new Date(monitoringDay().getTime() - 86400000), path: productPath, productId: "previous-public-product-id", views: 2n } });
  const html = await (await get("/account/monitoring/", admin)).text(); assert(html.includes(prefix) && html.includes("Все просмотры") && !html.includes('name="ip"') && !html.includes('name="country"'));
  assert.equal((html.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1].match(/<tr>/g) || []).length, 3, "One total per public URL even when a product was recreated");
  const markup = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(match => match[0]).find(value => value.includes("clear-all-monitoring")); assert(markup);
  const form = new FormData();
  for (const input of markup.matchAll(/<input\b[^>]*>/g)) { const name = input[0].match(/name="([^"]*)"/)?.[1], value = input[0].match(/value="([^"]*)"/)?.[1] || ""; if (name && name.startsWith("$ACTION")) form.set(name.replaceAll("&amp;", "&"), value.replaceAll("&amp;", "&").replaceAll("&quot;", '"')); }
  assert.match((await post("/account/monitoring/", form, admin)).headers.get("location") || "", /confirmation/);
  form.set("confirmation", "clear-all-monitoring"); assert.match((await post("/account/monitoring/", form, buyer)).headers.get("location") || "", /forbidden/);
  assert((await post("/account/monitoring/", form, admin, { Origin: "https://foreign.invalid" })).status >= 400);
  assert.match((await post("/account/monitoring/", form, admin)).headers.get("location") || "", /cleared/);
  assert.equal(await prisma.monitoringCounter.count(), 0);
  assert.equal(await prisma.order.count(), finance[0]); assert.equal(await prisma.user.count(), finance[1] + 1);
  for (const path of ["/catalog/", "/login/", "/legal/cookies/"]) { const response = await get(path); const text = await response.text(); assert.equal(response.status, 200); assert(!text.includes("Разрешить статистику") && !text.includes("Только необходимые") && !text.includes('class="cookie-banner"')); }
  const cookies = await (await get("/legal/cookies/")).text(); assert(cookies.includes("3dp_session") && cookies.includes("3dp_cart") && cookies.includes("3dp_order_*") && cookies.includes("суточный счётчик"));
  assert(monitoringDay().getUTCHours() === 0);
  console.log("PASS: aggregate daily page/product totals without identity fields; anonymous counting, concurrent increments, private/query/forged-event rejection, retired personal API/database writes, cookie expiry, 30-day pruning, permission/CSRF-confirmed clearing and no cookie banner. Synthetic local QA only.");
} finally {
  await prisma.monitoringCounter.deleteMany(); if (original.length) await prisma.monitoringCounter.createMany({ data: original });
  await prisma.auditLog.deleteMany({ where: { action: "monitoring.clear", id: { notIn: audits } } });
  await prisma.session.deleteMany({ where: { id: { in: sessions } } });
  if (buyerId) await prisma.user.deleteMany({ where: { id: buyerId } });
  if (productId) await prisma.product.deleteMany({ where: { id: productId } });
  if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.$disconnect();
}
