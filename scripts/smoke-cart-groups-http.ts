import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { prisma } from "../src/lib/prisma";
import { reserveStock } from "../src/lib/stock-reservations";
import { expireCartHold } from "../src/lib/cart-stock-holds";

const base = new URL(process.env.SMOKE_BASE_URL || "http://localhost:3101"), db = new URL(process.env.DATABASE_URL || "");
assert(["localhost", "127.0.0.1"].includes(base.hostname) && ["localhost", "127.0.0.1"].includes(db.hostname) && db.pathname === "/shop_qa");
const manifest = JSON.parse(await readFile(".next/server/server-reference-manifest.json", "utf8"));
const actionId = Object.entries(manifest.node).find(([, v]) => (v as { exportedName: string }).exportedName === "updateCheckoutCartGroup")?.[0];
assert(actionId, "Missing group action");
const prefix = `qa-cart-${randomUUID().slice(0, 8)}`, sessionKey = randomBytes(24).toString("base64url");
const jar = new Map([["3dp_cart", sessionKey]]), colorIds: string[] = [];
let cartId = "", productId = "", extraProductId = "", categoryId = "";
const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
async function request(path: string, init: RequestInit = {}) {
  const response = await fetch(new URL(path, base), { ...init, redirect: "manual", headers: { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "), ...init.headers }, signal: AbortSignal.timeout(15000) });
  for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(";")[0], i = pair.indexOf("="); jar.set(pair.slice(0, i), pair.slice(i + 1)); }
  return response;
}
async function cartGroups() {
  const res = await request("/cart/"); assert.equal(res.status, 200);
  const html = await res.text(), articles = [...html.matchAll(/<article class="cart-item">[\s\S]*?<\/article>/g)].map(m => m[0]);
  return { html, groups: articles.map(article => {
    const value = article.match(/<input[^>]*name="members"[^>]*value="([^"]*)"/)?.[1]; assert(value, "Missing member snapshot");
    return { article, members: JSON.parse(decode(value)) as Array<{ id: string; quantity: number; revision: string; state: string }> };
  }) };
}
async function update(members: unknown, quantity: number) {
  const res = await request("/cart/", { method: "POST", headers: { "Next-Action": actionId!, Origin: base.origin, "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component" }, body: JSON.stringify([members, quantity]) });
  assert.equal(res.status, 200); return res.text();
}
async function addForm() {
  const response = await request(`/catalog/${prefix}/${prefix}-product/`); assert.equal(response.status, 200);
  const html = (await response.text()).replace(/<!--[\s\S]*?-->/g, "");
  const markup = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(x => x[0]).find(x => x.includes('name="productId"')); assert(markup);
  const form = new FormData();
  for (const input of markup.matchAll(/<input\b[^>]*>/g)) {
    const name = input[0].match(/name="([^"]*)"/)?.[1], value = input[0].match(/value="([^"]*)"/)?.[1] || "";
    if (name && (name.startsWith("$ACTION") || input[0].includes('type="hidden"'))) form.set(decode(name), decode(value));
  }
  form.set("quantity", "1"); form.set("material", ""); form.set("color", `${prefix}-red`);
  return form;
}
try {
  const category = await prisma.category.create({ data: { slug: prefix, name: prefix, visible: true } }); categoryId = category.id;
  for (const name of ["red", "blue"]) colorIds.push((await prisma.color.create({ data: { slug: `${prefix}-${name}`, name, hex: "#000000" } })).id);
  const product = await prisma.product.create({ data: { sku: prefix, name: prefix, slug: `${prefix}-product`, basePrice: 100, status: "PUBLISHED", stock: 5, madeToOrder: false, categories: { create: { categoryId, isPrimary: true } }, colors: { connect: colorIds.map(id => ({ id })) } } }); productId = product.id;
  const variants = await Promise.all(colorIds.map((colorId, i) => prisma.productVariant.create({ data: { productId, colorId, sku: `${prefix}-v${i}`, price: 100, stock: 5 } })));
  const cart = await prisma.cart.create({ data: { sessionKey } }); cartId = cart.id;
  const createdAt = new Date();
  for (const color of ["red", "red", "blue"]) await prisma.cartItem.create({ data: { cartId, productId, variantId: variants[color === "red" ? 0 : 1].id, quantity: 1, unitPrice: 100, config: { material: "", materialName: "", color: `${prefix}-${color}`, colorName: color }, createdAt } });
  let snapshot = await cartGroups();
  assert.equal(snapshot.groups.length, 2, "Two equal rows form one position; another variant remains separate");
  const red = snapshot.groups.find(g => g.members.length === 2); const blue = snapshot.groups.find(g => g.members.length === 1);
  assert(red && blue);
  // React may insert comment nodes between adjacent server-rendered text pieces.
  const visibleText = (html: string) => decode(html.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, ""));
  assert.match(visibleText(red.article), /2\s*шт\./);
  assert.match(visibleText(blue.article), /1\s*шт\./);
  assert.equal(red.members.reduce((sum, row) => sum + row.quantity, 0), 2);
  assert.equal(blue.members.reduce((sum, row) => sum + row.quantity, 0), 1);
  assert.equal(await prisma.cartItem.count({ where: { cartId } }), 3, "Rendering must not mutate cart");
  const checkoutMarkup = [...snapshot.html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(match => match[0]).find(value => value.includes("ОФОРМИТЬ ЗАКАЗ"));
  assert(checkoutMarkup, "Checkout must be an explicit reservation action");
  const startCheckout = new FormData();
  for (const input of checkoutMarkup.matchAll(/<input\b[^>]*>/g)) {
    const name = input[0].match(/name="([^"]*)"/)?.[1], value = input[0].match(/value="([^"]*)"/)?.[1] || "";
    if (name && (name.startsWith("$ACTION") || input[0].includes('type="hidden"'))) startCheckout.set(decode(name), decode(value));
  }
  assert.equal((await request("/cart/", { method: "POST", headers: { Origin: base.origin }, body: startCheckout })).headers.get("location"), "/checkout/");
  const hold = await prisma.cartStockHold.findUniqueOrThrow({ where: { cartId }, include: { items: true } });
  assert.equal(hold.items[0].quantity, 3);
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).reservedStock, 3);
  assert.equal((await cartGroups()).groups.length, 2, "A buyer must still see their own reserved stock");
  assert(!(await update(red.members, 3)).includes("Корзина изменилась"));
  assert.equal((await prisma.cartItem.findMany({ where: { cartId, variantId: variants[0].id } })).reduce((sum, row) => sum + row.quantity, 0), 3);
  assert((await update(red.members, 2)).includes("Корзина изменилась"), "Old snapshot cannot overwrite updated cart");
  snapshot = await cartGroups(); const latest = snapshot.groups.find(g => g.members.some(m => m.id === red.members[0].id)); assert(latest);
  assert(!(await update(latest.members, 2)).includes("Корзина изменилась"));
  snapshot = await cartGroups(); const raceGroup = snapshot.groups.find(g => g.members.some(m => m.id === red.members[0].id)); assert(raceGroup);
  const raced = await Promise.all([update(raceGroup.members, 3), update(raceGroup.members, 4)]);
  assert.equal(raced.filter(body => body.includes("Корзина изменилась")).length, 1, "One stale concurrent update must fail");
  const redTotal = (await prisma.cartItem.findMany({ where: { cartId, variantId: variants[0].id } })).reduce((n, row) => n + row.quantity, 0);
  assert([3, 4].includes(redTotal));
  snapshot = await cartGroups(); const stale = snapshot.groups.find(g => g.members.some(m => m.id === red.members[0].id)); assert(stale);
  const add = await addForm();
  const [updateBody, added] = await Promise.all([update(stale.members, redTotal), request(`/catalog/${prefix}/${prefix}-product/`, { method: "POST", headers: { Origin: base.origin }, body: add })]);
  assert([303, 200].includes(added.status));
  const after = await prisma.cartItem.findMany({ where: { cartId, productId } });
  const total = after.reduce((sum, row) => sum + row.quantity, 0);
  assert(total <= 5, "Concurrent requests cannot exceed available stock");
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).reservedStock, total, "Changing a held cart must adjust its reserve");
  if ((added.headers.get("location") ?? "").includes("error=stock")) assert.equal(total, redTotal + 1);
  else assert.equal(total, redTotal + 2, "Successful concurrent add must not be lost");
  if (updateBody.includes("Корзина изменилась")) assert.equal(total, redTotal + 2);
  await assert.rejects(prisma.$transaction(tx => reserveStock(tx, [{ productId, quantity: 3 }, { productId, quantity: 3 }])), /stock-changed/, "Checkout must sum duplicate rows before reserving");
  snapshot = await cartGroups(); const remove = snapshot.groups.find(g => g.members.some(m => m.id === blue.members[0].id)); assert(remove);
  const removal = new FormData();
  for (const input of remove.article.matchAll(/<input\b[^>]*>/g)) {
    const name = input[0].match(/name="([^"]*)"/)?.[1], value = input[0].match(/value="([^"]*)"/)?.[1] || "";
    if (name && (name.startsWith("$ACTION") || input[0].includes('type="hidden"'))) removal.set(decode(name), decode(value));
  }
  assert.equal((await request("/cart/", { method: "POST", headers: { Origin: base.origin }, body: removal })).headers.get("location"), "/cart/");
  assert.equal(await prisma.cartItem.count({ where: { cartId, variantId: variants[1].id } }), 0);
  assert((await prisma.cartItem.count({ where: { cartId, variantId: variants[0].id } })) > 0, "Removing one variant must preserve the other");
  const lastHold = await prisma.cartStockHold.findUniqueOrThrow({ where: { cartId } });
  await expireCartHold(prisma, lastHold.id, new Date(Date.now() + 31 * 60_000));
  await prisma.product.update({ where: { id: productId }, data: { stock: 0 } });
  const soldOutHtml = await (await request("/cart/")).text();
  const soldOut = soldOutHtml.match(/<article class="cart-item cart-item--unavailable">[\s\S]*?<\/article>/)?.[0];
  assert(soldOut?.includes("не войдёт в заказ") && !soldOut.includes("Количество товара:"), "Sold-out rows only offer removal");
  assert.match(soldOutHtml, /<button\b[^>]*disabled[^>]*>ОФОРМИТЬ ЗАКАЗ<\/button>/);
  const extra = await prisma.product.create({ data: { sku: `${prefix}-available`, name: `${prefix}-available`, slug: `${prefix}-available`, basePrice: 123, status: "PUBLISHED", stock: 2, madeToOrder: false, categories: { create: { categoryId, isPrimary: true } } } }); extraProductId = extra.id;
  await prisma.cartItem.create({ data: { cartId, productId: extra.id, quantity: 1, unitPrice: 123, config: {} } });
  const mixedHtml = await (await request("/cart/")).text();
  assert(mixedHtml.includes("ОФОРМИТЬ ЗАКАЗ") && mixedHtml.includes("123 ₽"), "An available row remains orderable and contributes to the total");
  const mixedMarkup = [...mixedHtml.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(match => match[0]).find(value => value.includes("ОФОРМИТЬ ЗАКАЗ")); assert(mixedMarkup);
  const mixedStart = new FormData();
  for (const input of mixedMarkup.matchAll(/<input\b[^>]*>/g)) {
    const name = input[0].match(/name="([^"]*)"/)?.[1], value = input[0].match(/value="([^"]*)"/)?.[1] || "";
    if (name && (name.startsWith("$ACTION") || input[0].includes('type="hidden"'))) mixedStart.set(decode(name), decode(value));
  }
  assert.equal((await request("/cart/", { method: "POST", headers: { Origin: base.origin }, body: mixedStart })).headers.get("location"), "/checkout/");
  const mixedHold = await prisma.cartStockHold.findUniqueOrThrow({ where: { cartId }, include: { items: true } });
  assert.deepEqual(mixedHold.items.map(item => item.productId), [extra.id], "Sold-out rows must not be held");
  console.log("PASS: virtual cart grouping, variants, quantity, stale/concurrent mutations, addition and checkout stock protection.");
} finally {
  const hold = cartId ? await prisma.cartStockHold.findUnique({ where: { cartId } }) : null;
  if (hold) await expireCartHold(prisma, hold.id, new Date(Date.now() + 31 * 60_000));
  if (cartId) await prisma.cart.deleteMany({ where: { id: cartId } });
  if (productId) await prisma.product.deleteMany({ where: { id: productId } });
  if (extraProductId) await prisma.product.deleteMany({ where: { id: extraProductId } });
  if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.color.deleteMany({ where: { id: { in: colorIds } } });
  await prisma.$disconnect();
}

