// Integration smoke test. Intentionally refuses non-local servers / non-test DBs.
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
const base = new URL(process.env.SMOKE_BASE_URL || "http://localhost:3101");
const database = new URL(process.env.DATABASE_URL || "");
assert(["localhost", "127.0.0.1"].includes(base.hostname) && ["localhost", "127.0.0.1"].includes(database.hostname) && database.pathname === "/shop_qa", "Only the disposable local shop_qa database is allowed");
const db = new PrismaClient(), jar = new Map();
async function request(path, body, authenticated = true) {
  const response = await fetch(new URL(path, base), { method: body ? "POST" : "GET", redirect: "manual", headers: { ...(authenticated ? { Cookie: [...jar].map(([k, v]) => k + "=" + v).join("; ") } : {}), ...(body ? { Origin: base.origin } : {}) }, body });
  if (authenticated) for (const item of response.headers.getSetCookie()) { const pair = item.split(";")[0], at = pair.indexOf("="); jar.set(pair.slice(0, at), pair.slice(at + 1)); }
  return response;
}
async function form(path, containing) {
  const response = await request(path); assert.equal(response.status, 200);
  const html = await response.text();
  const markup = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map((m) => m[0]).find((text) => text.includes(containing));
  assert(markup, "Form missing: " + containing);
  const body = new FormData();
  for (const match of markup.matchAll(/<input\b[^>]*>/g)) {
    const name = match[0].match(/name="([^"]*)"/)?.[1], value = match[0].match(/value="([^"]*)"/)?.[1] || "";
    if (name && (name.startsWith("$ACTION") || match[0].includes('type="hidden"'))) body.set(name.replace(/&amp;/g, "&"), value.replace(/&amp;/g, "&"));
  }
  return body;
}
try {
  const product = await form("/catalog/organizers/modular-desk-organizer/", 'name="productId"');
  for (const [key, value] of Object.entries({ material: "petg", color: "graphite", quality: "fine", quantity: "2" })) product.set(key, value);
  assert.equal((await request("/catalog/organizers/modular-desk-organizer/", product)).headers.get("location"), "/cart/");
  const item = await db.cartItem.findFirstOrThrow({ where: { cart: { sessionKey: jar.get("3dp_cart") } } });
  assert.equal(Number(item.unitPrice), 2370); assert.equal(item.quantity, 2);
  const edit = await form("/cart/", 'name="productId"');
  for (const [key, value] of Object.entries({ material: "petg", color: "graphite", quality: "fine", quantity: "3" })) edit.set(key, value);
  assert.equal((await request("/cart/", edit)).headers.get("location"), "/cart/");
  const checkout = await form("/checkout/", 'name="expectedTotal"');
  for (const [key, value] of Object.entries({ name: "Локальный тест", email: "smoke@example.test", phone: "+7 (999) 123-45-67", city: "Москва", postalCode: "123456", address: "Тестовая, 1", delivery: "russian-post", payment: "manual", legal: "on", comment: "Disposable local integration test", expectedTotal: "1" })) checkout.set(key, value);
  assert.equal((await request("/checkout/", checkout)).headers.get("location"), "/checkout/?error=price");
  checkout.set("expectedTotal", "7500");
  const before = await db.order.count();
  const response = await request("/checkout/", checkout), location = response.headers.get("location");
  assert.match(location || "", /^\/checkout\/success\/3DP-/);
  const number = location.split("/")[3];
  const order = await db.order.findUniqueOrThrow({ where: { number }, include: { items: true, payment: true, notifications: true } });
  assert.equal(Number(order.subtotal), 7110); assert.equal(Number(order.deliveryPrice), 390); assert.equal(Number(order.total), 7500);
  assert.equal(order.items[0].quantity, 3); assert.equal(order.items[0].configuration.materialName, "PETG"); assert.equal(order.items[0].configuration.quality, "fine");
  assert.equal(order.payment.status, "PENDING"); assert.equal(order.notifications[0].status, "NOT_CONFIGURED");
  assert.equal((await request(location)).status, 200);
  assert.equal((await request(location, undefined, false)).status, 404);
  await request("/checkout/", checkout);
  assert.equal(await db.order.count(), before + 1);
  assert.equal(await db.cartItem.count({ where: { cartId: item.cartId } }), 0);
  console.log("PASS: shared price, cart editing, delivery total, tampered total rejection, order configuration, guest access, duplicate-submit protection; local order " + number);
} finally { await db.$disconnect(); }
