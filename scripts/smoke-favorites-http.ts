import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { prisma } from "../src/lib/prisma";
import { hashPassword } from "../src/lib/password";
import { FAVORITES_COOKIE, MAX_FAVORITES } from "../src/lib/favorites-policy";

const base = new URL(process.env.SMOKE_BASE_URL || "http://localhost:3101");
const db = new URL(process.env.DATABASE_URL || "");
assert(["localhost", "127.0.0.1"].includes(base.hostname) && ["localhost", "127.0.0.1"].includes(db.hostname) && db.pathname === "/shop_qa", "Synthetic local QA only");
const manifest = JSON.parse(await readFile(".next/server/server-reference-manifest.json", "utf8"));
const actionId = Object.entries(manifest.node).find(([, value]) => (value as { exportedName: string }).exportedName === "setFavorite")?.[0];
assert(actionId);
type Jar = Map<string, string>;
async function request(jar: Jar, path: string, init: RequestInit = {}) {
  const response = await fetch(new URL(path, base), { ...init, redirect: "manual", headers: { Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; "), ...init.headers }, signal: AbortSignal.timeout(15000) });
  for (const cookie of response.headers.getSetCookie()) {
    const pair = cookie.split(";")[0], at = pair.indexOf("=");
    const key = pair.slice(0, at), value = pair.slice(at + 1);
    if (value) jar.set(key, value); else jar.delete(key);
  }
  return response;
}
async function favorite(jar: Jar, id: string, selected: boolean, origin = base.origin) {
  const response = await request(jar, "/favorites/", { method: "POST", headers: { "Next-Action": actionId!, Origin: origin, "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component" }, body: JSON.stringify([id, selected]) });
  const body = await response.text();
  return { response, body };
}
const prefix = `qa-favorites-${randomUUID().slice(0, 8)}`, password = "LocalFavoritesQA-2026";
const userIds: string[] = [], productIds: string[] = [], categoryIds: string[] = [];
try {
  const category = await prisma.category.create({ data: { name: "QA Избранное", slug: prefix, visible: true } }); categoryIds.push(category.id);
  const hiddenCategory = await prisma.category.create({ data: { name: "QA Скрытая", slug: `${prefix}-hidden`, visible: false } }); categoryIds.push(hiddenCategory.id);
  for (let index = 0; index < MAX_FAVORITES + 3; index++) {
    const product = await prisma.product.create({ data: { name: `QA Избранное ${index}`, sku: `${prefix}-${index}`, slug: `${prefix}-${index}`, status: index === MAX_FAVORITES + 1 ? "DRAFT" : "PUBLISHED", type: "READY", basePrice: 240, stock: 10, categories: { create: { categoryId: index === MAX_FAVORITES + 2 ? hiddenCategory.id : category.id, isPrimary: true } }, images: { create: { path: "/generated/product-organizer.webp", alt: "QA", width: 900, height: 1200 } } } }); productIds.push(product.id);
  }
  const jars: Jar[] = [];
  for (let i = 0; i < 2; i++) {
    const user = await prisma.user.create({ data: { email: `${prefix}-${i}@example.test`, name: "QA Избранное", passwordHash: hashPassword(password) } }); userIds.push(user.id);
    const token = randomBytes(32).toString("base64url");
    await prisma.session.create({ data: { userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3600000) } });
    jars.push(new Map([["3dp_session", token]]));
  }
  const guest: Jar = new Map();
  const empty = await request(guest, "/favorites/");
  assert.equal(empty.status, 200); assert(empty.headers.get("cache-control")?.includes("no-store")); assert((await empty.text()).includes("Пока ничего не сохранено"));
  const saved = await favorite(guest, productIds[0], true);
  assert.equal(saved.response.status, 200); assert.equal(guest.get(FAVORITES_COOKIE), productIds[0]);
  const cookie = saved.response.headers.getSetCookie().find(value => value.startsWith(`${FAVORITES_COOKIE}=`));
  assert(cookie?.includes("HttpOnly") && cookie.includes("SameSite=lax") && cookie.includes("Max-Age=2592000"));
  await favorite(guest, productIds[0], true); assert.equal(guest.get(FAVORITES_COOKIE), productIds[0], "Retry must not remove or duplicate a favorite");
  let html = await (await request(guest, "/favorites/")).text();
  assert(html.includes('aria-label="Избранное: 1"') && html.includes('class="header-count"') && html.includes('aria-pressed="true"'));
  assert.equal((html.match(/<article class="product-card">/g) || []).length, 1);
  for (const id of [productIds[MAX_FAVORITES + 1], productIds[MAX_FAVORITES + 2], "not-a-product"]) { await favorite(guest, id, true); assert.equal(guest.get(FAVORITES_COOKIE), productIds[0], "Only visible published products are accepted"); }
  const crossSite = await favorite(guest, productIds[1], true, "https://untrusted.example"); assert(crossSite.response.status >= 400); assert.equal(guest.get(FAVORITES_COOKIE), productIds[0]);
  await favorite(guest, productIds[0], false); assert(!guest.has(FAVORITES_COOKIE));
  guest.set(FAVORITES_COOKIE, productIds.slice(0, MAX_FAVORITES).join("."));
  const capped = await favorite(guest, productIds[MAX_FAVORITES], true); assert(capped.body.includes("Можно сохранить до 50 товаров")); assert.equal(guest.get(FAVORITES_COOKIE)?.split(".").length, MAX_FAVORITES);
  guest.set(FAVORITES_COOKIE, productIds[1]);
  await favorite(jars[0], productIds[0], true);
  await favorite(jars[0], productIds[0], true);
  assert.equal(await prisma.productFavorite.count({ where: { userId: userIds[0] } }), 1);
  assert(!(await (await request(jars[1], "/favorites/")).text()).includes('aria-label="Избранное: 1"'));
  await favorite(jars[1], productIds[0], false);
  assert.equal(await prisma.productFavorite.count({ where: { userId: userIds[0] } }), 1, "Another account cannot remove the owner's favorite");
  await prisma.productFavorite.createMany({ data: productIds.slice(1, MAX_FAVORITES).map(productId => ({ userId: userIds[0], productId })) });
  assert((await favorite(jars[0], productIds[MAX_FAVORITES], true)).body.includes("Можно сохранить до 50 товаров"));
  await prisma.productFavorite.deleteMany({ where: { userId: userIds[0], productId: { not: productIds[0] } } });
  const loginHtml = await (await request(guest, "/login/")).text();
  const formName = loginHtml.match(/name="(\$ACTION_ID_[^"]+)"/)?.[1]; assert(formName);
  const login = new FormData(); login.set(formName, ""); login.set("email", `${prefix}-0@example.test`); login.set("password", password); login.set("returnTo", "/favorites/");
  const signedIn = await request(guest, "/login/", { method: "POST", headers: { Origin: base.origin }, body: login });
  assert.equal(signedIn.status, 303); assert(guest.has("3dp_session")); assert(!guest.has(FAVORITES_COOKIE));
  assert.equal(await prisma.productFavorite.count({ where: { userId: userIds[0] } }), 2, "Guest favorites merge on sign-in");
  await prisma.productFavorite.create({ data: { userId: userIds[0], productId: productIds[MAX_FAVORITES + 1] } });
  html = await (await request(guest, "/favorites/")).text(); assert.equal((html.match(/<article class="product-card">/g) || []).length, 2, "Draft products remain hidden even if saved previously");
  const cart = await prisma.cart.create({ data: { userId: userIds[0], items: { create: { productId: productIds[0], quantity: 7, unitPrice: 240, config: {} } } } });
  html = await (await request(guest, "/favorites/")).text(); assert(html.includes('aria-label="Корзина: 7"'), "Cart badge counts units, not product rows");
  await prisma.cartItem.deleteMany({ where: { cartId: cart.id } }); await prisma.cart.delete({ where: { id: cart.id } });
  const legacy = await request(guest, "/account/favorites/"); assert.equal(legacy.status, 308); assert.equal(legacy.headers.get("location"), "/favorites/");
  console.log("Favorites HTTP smoke passed: guests, persistence, cap, visibility, CSRF, account isolation, login merge, private cache and cart quantity.");
} finally {
  await prisma.cartItem.deleteMany({ where: { cart: { userId: { in: userIds } } } });
  await prisma.cart.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.category.deleteMany({ where: { id: { in: categoryIds } } });
  await prisma.$disconnect();
}
