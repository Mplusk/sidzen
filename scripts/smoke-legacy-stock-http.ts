import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { Prisma } from "@prisma/client";
import { legacyStockReviewProductIds } from "../src/lib/legacy-stock-availability";
import { assertInlineCheckoutError } from "./assert-inline-checkout-error";

// The test must never be run against a production database or server.
const base = new URL(process.env.SMOKE_BASE_URL || "http://localhost:3101"), db = new URL(process.env.DATABASE_URL || "");
assert(["localhost", "127.0.0.1"].includes(base.hostname) && ["localhost", "127.0.0.1"].includes(db.hostname) && db.pathname === "/shop_qa");
const prefix = `qa-stock-${randomUUID().slice(0, 8)}`, jar = new Map<string, string>();
const ids: string[] = [], orders: { id: string; number: string }[] = [];
let categoryId = "", sessionId = "", cartId = "";
const operatorKeys = ["legal.seller", "legal.address", "contacts.email"];
const oldOperatorSettings = await prisma.siteSetting.findMany({ where: { key: { in: operatorKeys } } });
const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
async function request(path: string, body?: FormData) {
  const response = await fetch(new URL(path, base), { method: body ? "POST" : "GET", body, redirect: "manual", headers: { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "), ...(body ? { Origin: base.origin } : {}) } });
  for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(";")[0], i = pair.indexOf("="); jar.set(pair.slice(0, i), pair.slice(i + 1)); }
  return response;
}
async function form(path: string, marker: string) {
  const res = await request(path); assert.equal(res.status, 200);
  const html = (await res.text()).replace(/<!--[\s\S]*?-->/g, "");
  const markup = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(m => m[0]).find(f => f.includes(marker)); assert(markup, `Missing form: ${marker}`);
  const data = new FormData();
  for (const m of markup.matchAll(/<input\b[^>]*>/g)) {
    const name = m[0].match(/name="([^"]*)"/)?.[1], value = m[0].match(/value="([^"]*)"/)?.[1] || "";
    if (name && (name.startsWith("$ACTION") || m[0].includes('type="hidden"'))) data.set(decode(name), decode(value));
  }
  return data;
}
async function reconcile(order: { number: string }) {
  const path = `/admin/orders/${order.number}/`, body = await form(path, 'name="reviewSnapshot"');
  body.set("reason", "Фактический остаток и доставка проверены для теста");
  body.set("confirmation", order.number); body.set("reviewed", "on");
  assert.match((await request(path, body)).headers.get("location") ?? "", /legacyStock=saved/);
}
const cards = (s: string) => [...s.matchAll(/<article class="product-card">[\s\S]*?<\/article>/g)].map(m => m[0]);
try {
  for (const [key, value] of Object.entries({ "legal.seller": "Synthetic QA operator", "legal.address": "Synthetic QA address", "contacts.email": "operator@example.test" })) {
    await prisma.siteSetting.upsert({ where: { key }, create: { key, value, group: "legal" }, update: { value } });
  }
  const category = await prisma.category.create({ data: { slug: prefix, name: prefix, visible: true } }); categoryId = category.id;
  for (const [i, madeToOrder] of [[0, false], [1, true], [2, false]] as const) {
    const product = await prisma.product.create({ data: { name: `${prefix} name ${i}`, sku: `${prefix}-sku-${i}`, slug: `${prefix}-${i}`, basePrice: 100, stock: i === 1 ? 0 : 5, madeToOrder, status: "PUBLISHED", categories: { create: { categoryId, isPrimary: true } } } });
    ids.push(product.id);
  }
  for (const [i, productId] of [ids[0], ids[0], ids[1]].entries()) {
    const order = await prisma.order.create({ data: { number: `${prefix}-order-${i}`, inventoryTracked: false, customerName: "QA", customerPhone: "+70000000000", customerEmail: "qa@example.test", subtotal: 100, total: 100, items: { create: { productId, productName: `${prefix} item ${i}`, sku: i === 1 ? `${prefix}-variant` : `${prefix}-sku-${i === 2 ? 1 : 0}`, quantity: 1, unitPrice: 100, totalPrice: 100 } } } });
    orders.push({ id: order.id, number: order.number });
  }
  // An otherwise valid guest cart can open checkout even while the final
  // order remains protected by legacy inventory reconciliation.
  const cartKey = randomBytes(24).toString("base64url");
  const cart = await prisma.cart.create({ data: { sessionKey: cartKey, items: { create: { productId: ids[0], quantity: 1, unitPrice: 100, config: { material: "", materialName: "", color: "", colorName: "" } } } } });
  cartId = cart.id; jar.set("3dp_cart", cartKey);
  const cartResponse = await request("/cart/"); assert.equal(cartResponse.status, 200);
  const cartHtml = await cartResponse.text();
  assert.match(cartHtml, /href="\/checkout\/"[^>]*>ОФОРМИТЬ ЗАКАЗ<\/a>/);
  assert(!cartHtml.includes("Способ доставки и окончательную сумму выберете на следующем шаге."));
  const checkout = await request("/checkout/"); assert.equal(checkout.status, 200, "A valid legacy-blocked item can open checkout");
  const checkoutHtml = await checkout.text();
  assert(checkoutHtml.includes('name="name"') && checkoutHtml.includes("<form"), "Checkout must render the recipient form");
  const submission = await form("/checkout/", 'name="expectedTotal"');
  for (const [key, value] of Object.entries({ name: "QA Buyer", email: "qa-buyer@example.test", phone: "+79991234567", delivery: "pickup", legal: "on", expectedTotal: "100" })) submission.set(key, value);
  const orderCount = await prisma.order.count();
  const productBefore = await prisma.product.findUniqueOrThrow({ where: { id: ids[0] }, select: { stock: true, reservedStock: true } });
  await assertInlineCheckoutError(await request("/checkout/", submission), "stock-review");
  assert.equal(await prisma.order.count(), orderCount, "Review-blocked checkout must not create an order");
  assert.equal(await prisma.cartItem.count({ where: { cartId } }), 1, "Review-blocked checkout must preserve the cart");
  assert.deepEqual(await prisma.product.findUniqueOrThrow({ where: { id: ids[0] }, select: { stock: true, reservedStock: true } }), productBefore);
  await prisma.product.update({ where: { id: ids[0] }, data: { status: "DRAFT" } });
  assert((await (await request("/cart/")).text()).includes("ОФОРМИТЬ ЗАКАЗ"), "Cart action stays visible for a nonempty cart");
  assert.match((await request("/checkout/")).headers.get("location") ?? "", /^\/cart\/?\?error=unavailable/);
  await prisma.product.update({ where: { id: ids[0] }, data: { status: "PUBLISHED", stock: 0 } });
  assert.match((await request("/checkout/")).headers.get("location") ?? "", /^\/cart\/?\?error=unavailable/);
  await prisma.product.update({ where: { id: ids[0] }, data: { stock: 5 } });
  jar.delete("3dp_cart");
  const actor = await prisma.user.findUniqueOrThrow({ where: { email: "qa@example.test" } });
  const token = randomBytes(32).toString("base64url");
  sessionId = (await prisma.session.create({ data: { userId: actor.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 600000) } })).id;
  jar.set("3dp_session", token);
  const skuPage = await (await request(`/admin/orders/?view=stock-review&q=${encodeURIComponent(prefix + "-sku-0")}`)).text();
  assert(skuPage.includes(orders[0].number) && skuPage.includes(orders[1].number), "Search by current product SKU must include an old variant SKU");
  assert(!skuPage.includes(orders[2].number), "Unrelated order must not match");
  const namePage = await (await request(`/admin/orders/?view=stock-review&q=${encodeURIComponent(prefix + " item 0")}`)).text();
  assert(namePage.includes(orders[0].number) && !namePage.includes(orders[1].number), "Search must match the order item name");
  let blocked = await legacyStockReviewProductIds(ids);
  assert(blocked.has(ids[0]) && blocked.has(ids[1]) && !blocked.has(ids[2]));
  const normal = cards(await (await request(`/catalog/${prefix}/`)).text());
  assert(normal.find(c => c.includes(`${prefix}-0/`))?.includes("Наличие уточняется"));
  assert(normal.find(c => c.includes(`${prefix}-1/`))?.includes("Наличие уточняется"), "Made-to-order is also blocked");
  const stock = cards(await (await request(`/catalog/${prefix}/?availability=stock`)).text());
  assert(!stock.some(c => c.includes(`${prefix}-0/`)) && stock.some(c => c.includes(`${prefix}-2/`)));
  await reconcile(orders[0]);
  assert((await legacyStockReviewProductIds(ids)).has(ids[0]), "All old orders must be reconciled");
  await reconcile(orders[1]); await reconcile(orders[2]);
  blocked = await legacyStockReviewProductIds(ids);
  assert(!blocked.has(ids[0]) && !blocked.has(ids[1]));
  const refreshed = cards(await (await request(`/catalog/${prefix}/`)).text());
  assert(refreshed.find(c => c.includes(`${prefix}-0/`))?.includes("В наличии"));
  assert(refreshed.find(c => c.includes(`${prefix}-1/`))?.includes("Под заказ"));
  const refreshedStock = cards(await (await request(`/catalog/${prefix}/?availability=stock`)).text());
  assert(refreshedStock.some(c => c.includes(`${prefix}-0/`)), "Reconciled product returns to stock filter");
  const reconciledSearch = await (await request(`/admin/orders/?view=stock-review&q=${encodeURIComponent(prefix + "-sku-0")}`)).text();
  assert(!reconciledSearch.includes(orders[0].number) && !reconciledSearch.includes(orders[1].number));
  console.log("PASS: legacy SKU/name search, status for stock and made-to-order products, stock filter, and reconciliation via HTTP.");
} finally {
  await prisma.auditLog.deleteMany({ where: { entityId: { in: orders.map(o => o.id) } } });
  if (cartId) await prisma.cart.deleteMany({ where: { id: cartId } });
  await prisma.order.deleteMany({ where: { id: { in: orders.map(o => o.id) } } });
  await prisma.product.deleteMany({ where: { id: { in: ids } } });
  if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });
  if (sessionId) await prisma.session.deleteMany({ where: { id: sessionId } });
  for (const key of operatorKeys) {
    const old = oldOperatorSettings.find(row => row.key === key);
    if (old) await prisma.siteSetting.update({ where: { key }, data: { value: old.value === null ? Prisma.JsonNull : old.value as Prisma.InputJsonValue } });
    else await prisma.siteSetting.deleteMany({ where: { key } });
  }
  await prisma.$disconnect();
}
