import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { setProductsStatus } from "../src/lib/product-bulk";
import { applySnapshot, marketplaceLock } from "../src/lib/marketplaces/sync";
import { fetchPage } from "../src/lib/marketplaces/api";

const base = new URL(process.env.SMOKE_BASE_URL || "http://localhost:3101"), db = new URL(process.env.DATABASE_URL || "");
assert(["localhost", "127.0.0.1"].includes(base.hostname) && ["localhost", "127.0.0.1"].includes(db.hostname) && db.pathname === "/shop_qa");
const prefix = `qa-bulk-${randomUUID().slice(0, 8)}`, productIds: string[] = [], categoryIds: string[] = [], jar = new Map<string, string>();
let runId: string | undefined;
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
  return body;
}
try {
  const actor = await prisma.user.findUniqueOrThrow({ where: { email: "qa@example.test" } });
  for (const visible of [true, false]) categoryIds.push((await prisma.category.create({ data: { slug: `${prefix}-${visible}`, name: prefix, visible } })).id);
  for (let index = 0; index < 3; index++) productIds.push((await prisma.product.create({ data: { sku: `${prefix}-${index}`, slug: `${prefix}-${index}`, name: prefix, basePrice: 599, stock: 0, ...(index === 0 ? { categories: { create: { categoryId: categoryIds[0], isPrimary: true } } } : index === 2 ? { categories: { create: { categoryId: categoryIds[1], isPrimary: true } } } : {}) } })).id);
  const publish = { productIds, status: "PUBLISHED" as const, categoryId: "" }, admin = { id: actor.id, canPublish: true };
  await assert.rejects(setProductsStatus(publish, admin), /category/);
  assert.equal(await prisma.product.count({ where: { id: { in: productIds }, status: "DRAFT" } }), 3);
  await assert.rejects(setProductsStatus({ ...publish, categoryId: categoryIds[1] }, admin), /category/);
  await assert.rejects(setProductsStatus({ ...publish, categoryId: categoryIds[0] }, { ...admin, canPublish: false }), /permission/);
  await assert.rejects(setProductsStatus({ ...publish, productIds: [...productIds, "missing"] }, admin), /missing/);
  runId = (await prisma.marketplaceSyncRun.create({ data: { provider: "wb", accountId: prefix } })).id;
  await assert.rejects(setProductsStatus({ ...publish, categoryId: categoryIds[0] }, admin), /busy/);
  await prisma.marketplaceSyncRun.delete({ where: { id: runId } }); runId = undefined;
  const login = await form("/login/", 'name="email"'); login.set("email", "qa@example.test"); login.set("password", "LocalGalleryQA-2026");
  assert.equal((await request("/login/", login)).headers.get("location"), "/account/");
  const path = `/admin/products/?q=${prefix}`, body = await form(path, 'name="status"');
  for (const id of productIds) body.append("productIds", id);
  body.set("status", "PUBLISHED"); body.set("categoryId", categoryIds[0]);
  assert.match((await request(path, body, false)).headers.get("location") ?? "", /^\/login/);
  assert([400, 403, 500].includes((await request(path, body, true, "https://foreign.invalid")).status));
  const roles = await prisma.userRole.findMany({ where: { userId: actor.id } });
  try {
    await prisma.userRole.deleteMany({ where: { userId: actor.id } });
    assert.match((await request(path, body)).headers.get("location") ?? "", /forbidden/);
  } finally { await prisma.userRole.createMany({ data: roles, skipDuplicates: true }); }
  const response = await request(path, body); assert.equal(response.status, 200); assert((await response.text()).includes("Статус изменён у товаров: 3"));
  const published = await prisma.product.findMany({ where: { id: { in: productIds } }, include: { categories: { include: { category: true } } } });
  assert(published.every(item => item.status === "PUBLISHED" && item.publishedAt && item.stock === 0 && Number(item.basePrice) === 599 && item.categories.some(row => row.isPrimary && row.category.visible)));
  const publicHtml = await (await request(`/catalog/${prefix}-true/${prefix}-1/`, undefined, false)).text(); assert(publicHtml.includes(prefix));
  await assert.rejects(setProductsStatus({ ...publish, status: "HIDDEN" }, { ...admin, canPublish: false }), /permission/);
  const before = published.map(item => item.publishedAt?.toISOString()).sort();
  await setProductsStatus({ ...publish, productIds: [...productIds, productIds[0]] }, admin);
  assert.deepEqual((await prisma.product.findMany({ where: { id: { in: productIds } } })).map(item => item.publishedAt?.toISOString()).sort(), before);
  assert.equal(await prisma.auditLog.count({ where: { action: "product.status.bulk", entityId: { in: productIds } } }), 6);
  await setProductsStatus({ ...publish, status: "HIDDEN" }, admin);
  assert.equal(await prisma.product.count({ where: { id: { in: productIds }, status: "HIDDEN", publishedAt: null } }), 3);
  // Real WB adapter -> snapshot -> PostgreSQL, then SITE manual protection.
  const sku = `${prefix}-1`, connection = { accountId: prefix, clientId: "", secret: "fixture", name: prefix, checkedAt: "fixture" };
  const transport: typeof fetch = async url => Response.json(String(url).includes("/object/charcs/") ? { data: [{ charcID: 1, name: "Ширина предмета", unitName: "см" }, { charcID: 2, name: "Высота предмета", unitName: "см" }, { charcID: 3, name: "Вес товара без упаковки (г)", unitName: "г" }] } : { cards: [{ nmID: 11, subjectID: 5712, vendorCode: sku, title: prefix, dimensions: { length: 19, width: 19, height: 6, weightBrutto: 0.185 }, characteristics: [{ id: 1, name: "Ширина предмета", value: 18 }, { id: 2, name: "Высота предмета", value: 4.5 }, { id: 3, name: "Вес товара без упаковки (г)", value: 120 }] }], cursor: { total: 1 } });
  const item = (await fetchPage("wb", connection, {}, transport, new Map([["11", { nmID: "11", currencyIsoCode4217: "RUB", sizes: [{ price: 599, discountedPrice: 599 }] }]]))).items[0];
  await prisma.$transaction(async tx => { await marketplaceLock(tx); await applySnapshot(tx, "wb", prefix, item); });
  let measured = await prisma.product.findUniqueOrThrow({ where: { id: productIds[1] } });
  assert.equal(Number(measured.widthMm), 180); assert.equal(Number(measured.heightMm), 45); assert.equal(Number(measured.weightGrams), 120); assert.equal(measured.shippingWeightG, 185); assert.equal(measured.shippingLengthMm, 190); assert.equal(measured.shippingHeightMm, 60); assert.equal(measured.depthMm, null); assert.equal(measured.status, "HIDDEN");
  await prisma.product.update({ where: { id: measured.id }, data: { marketplaceMode: "SITE", widthMm: 999, shippingWeightG: 222 } });
  await prisma.$transaction(async tx => { await marketplaceLock(tx); await applySnapshot(tx, "wb", prefix, item); });
  measured = await prisma.product.findUniqueOrThrow({ where: { id: measured.id } }); assert.equal(Number(measured.widthMm), 999); assert.equal(measured.shippingWeightG, 222);
  assert.equal(await prisma.product.count({ where: { id: { in: productIds } } }), 3);
  console.log("PASS: bulk publication/hiding, atomic validation, visible category fallback, stable dates, deduplicated selection, audit, auth/role/CSRF, and real WB measurements pipeline/manual protection. Local fixtures only.");
} finally {
  if (runId) await prisma.marketplaceSyncRun.deleteMany({ where: { id: runId } });
  await prisma.marketplaceListing.deleteMany({ where: { accountId: prefix } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: productIds }, action: "product.status.bulk" } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.category.deleteMany({ where: { id: { in: categoryIds } } });
  await prisma.$disconnect();
}
