import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";

const base = new URL(process.env.SMOKE_BASE_URL || "http://localhost:3101");
const db = new URL(process.env.DATABASE_URL || "");
assert(["localhost", "127.0.0.1"].includes(base.hostname) && ["localhost", "127.0.0.1"].includes(db.hostname) && db.pathname === "/shop_qa");
const jar = new Map<string, string>();
let productId: string | undefined, cartId: string | undefined, categoryId: string | undefined;
async function request(path: string, body?: FormData) {
  const response = await fetch(new URL(path, base), { method: body ? "POST" : "GET", redirect: "manual", headers: { Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; "), ...(body ? { Origin: base.origin } : {}) }, body, signal: AbortSignal.timeout(15000) });
  for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(";")[0], at = pair.indexOf("="); jar.set(pair.slice(0, at), pair.slice(at + 1)); }
  return response;
}
function actionForm(html: string, containing: string) {
  const markup = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(match => match[0]).find(text => text.includes(containing));
  assert(markup, `Missing form ${containing}`);
  const form = new FormData();
  for (const match of markup.matchAll(/<input\b[^>]*>/g)) {
    const name = match[0].match(/name="([^"]*)"/)?.[1], value = match[0].match(/value="([^"]*)"/)?.[1] || "";
    if (name && (name.startsWith("$ACTION") || match[0].includes('type="hidden"'))) form.set(name.replace(/&amp;/g, "&"), value.replace(/&amp;/g, "&"));
  }
  return form;
}
try {
  const prefix = `qa-card-${randomUUID().slice(0, 8)}`;
  const category = await prisma.category.create({ data: { name: "QA Категория", slug: `${prefix}-category`, visible: true } });
  categoryId = category.id;
  const product = await prisma.product.create({ data: { name: "QA Салфетница Вершина", sku: prefix, slug: prefix, type: "READY", status: "PUBLISHED", publishedAt: new Date(), basePrice: 240, oldPrice: 300, stock: 0, madeToOrder: false, shortDescription: "QA description must not crowd the catalog card", description: "Первый абзац.\n\nВторой абзац.", specifications: { "Материал": "PLA пластик", "Цвет товара": "черный", "Вес с упаковкой, г": "85", "Ozon · 22232": "legacy technical", "Пустая строка": "" }, categories: { create: { categoryId: category.id, isPrimary: true } }, images: { create: [{ path: "/generated/product-organizer.webp", alt: "Фото 1", sortOrder: 0 }, { path: "/generated/product-mount.webp", alt: "Фото 2", sortOrder: 1 }] } } });
  productId = product.id;
  const catalog = await request(`/catalog/${category.slug}/?q=${prefix}`); assert.equal(catalog.status, 200);
  const catalogHtml = await catalog.text();
  const card = catalogHtml.match(/<article class="product-card">[\s\S]*?<\/article>/)?.[0]?.replace(/<!--[\s\S]*?-->/g, "");
  assert(card && card.includes(product.name));
  assert(card.indexOf('product-card__price') < card.indexOf('<h3>'));
  assert(card.includes('product-card__discount') && card.includes('−20') && card.includes('Нет в наличии'));
  assert(!card.includes(product.shortDescription!) && !card.includes('Базовая цена') && !card.includes('round-link'));
  assert(card.includes('gallery-dots') && card.includes('aria-pressed="true"'));
  assert(catalogHtml.includes('role="search"') && catalogHtml.includes('action="/catalog/"') && catalogHtml.includes('catalog-category-strip'));
  const path = `/catalog/${category.slug}/${product.slug}/`;
  const response = await request(path); assert.equal(response.status, 200);
  let html = await response.text();
  const table = html.match(/<table class="spec-table">[\s\S]*?<\/table>/)?.[0];
  assert(table); assert(table.includes("PLA пластик") && table.includes("черный") && table.includes("Вес с упаковкой, г"));
  for (const text of ["Ozon", "0 × 0", "Технология", "Срок изготовления", "Пустая строка"]) assert(!table.includes(text));
  assert(html.includes('class="product-description"'));
  assert(html.includes("Следующее фото") && html.includes("Предыдущее фото"));
  assert(html.includes("Товар временно отсутствует в наличии.")); assert(!html.includes("Уменьшите количество."));
  assert(!html.includes(">Добавить в корзину</button>"));
  const purchase = actionForm(html, 'name="productId"'); purchase.set("quantity", "1");
  assert.equal((await request(path, purchase)).headers.get("location"), "/cart/?error=stock");
  assert.equal(await prisma.cartItem.count({ where: { productId } }), 0);
  await prisma.product.update({ where: { id: productId }, data: { stock: 2 } });
  html = await (await request(path)).text(); assert(html.includes(">Добавить в корзину</button>")); assert(html.includes("На следующий рабочий день"));
  const available = actionForm(html, 'name="productId"'); available.set("quantity", "3");
  assert.equal((await request(path, available)).headers.get("location"), "/cart/?error=stock");
  available.set("quantity", "1");
  assert.equal((await request(path, available)).headers.get("location"), "/cart/");
  let item = await prisma.cartItem.findFirstOrThrow({ where: { productId } }); cartId = item.cartId;
  assert.equal(item.quantity, 1); assert.equal(Number(item.unitPrice), 240);
  html = await (await request("/cart/")).text(); assert(html.includes(product.name));
  assert.equal((await request("/cart/", actionForm(html, ">Удалить</button>"))).headers.get("location"), "/cart/");
  assert.equal(await prisma.cartItem.count({ where: { productId } }), 0);
  await prisma.product.update({ where: { id: productId }, data: { stock: 0, madeToOrder: true } });
  html = await (await request(path)).text(); assert(html.includes("Срок изготовления") && html.includes("3–5 рабочих дней"), html.match(/<table class="spec-table">[\s\S]*?<\/table>/)?.[0] || "Missing specification table");
  const onOrder = actionForm(html, 'name="productId"'); onOrder.set("quantity", "1");
  assert.equal((await request(path, onOrder)).headers.get("location"), "/cart/");
  item = await prisma.cartItem.findFirstOrThrow({ where: { productId } }); assert.equal(item.cartId, cartId);
  html = await (await request("/cart/")).text();
  assert.equal((await request("/cart/", actionForm(html, ">Удалить</button>"))).headers.get("location"), "/cart/");
  console.log("PASS: dense catalog cards, price before title, real discount/availability, photo dots, header search, product HTML, readable specifications, absent empty/legacy rows, description paragraphs, two-photo gallery controls, out-of-stock purchase rejection, in-stock cart addition/removal, quantity limit, made-to-order purchase. Isolated QA data only; no orders or payments.");
} finally {
  if (cartId) await prisma.cart.deleteMany({ where: { id: cartId } });
  if (productId) await prisma.product.deleteMany({ where: { id: productId } });
  if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.$disconnect();
}
