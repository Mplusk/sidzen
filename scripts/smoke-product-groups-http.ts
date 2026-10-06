import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/lib/prisma";

const base = new URL(process.env.SMOKE_BASE_URL || "http://localhost:3101"), db = new URL(process.env.DATABASE_URL || "");
assert(["localhost", "127.0.0.1"].includes(base.hostname) && ["localhost", "127.0.0.1"].includes(db.hostname) && db.pathname === "/shop_qa");
const prefix = `qa-group-${randomUUID().slice(0, 8)}`, ids: string[] = [], jar = new Map<string, string>();
let categoryId: string | undefined, groupId: string | undefined, cartId: string | undefined;
async function request(path: string, body?: FormData, authenticated = true, origin = base.origin) {
  const response = await fetch(new URL(path, base), { method: body ? "POST" : "GET", body, redirect: "manual", headers: { ...(authenticated ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}), ...(body ? { Origin: origin } : {}) } });
  if (authenticated) for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(";")[0], at = pair.indexOf("="); jar.set(pair.slice(0, at), pair.slice(at + 1)); }
  return response;
}
async function form(path: string, containing: string) {
  const response = await request(path); assert.equal(response.status, 200);
  const html = await response.text(), markup = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(m => m[0]).find(text => text.includes(containing)); assert(markup);
  const body = new FormData();
  for (const match of markup.matchAll(/<input\b[^>]*>/g)) {
    const name = match[0].match(/name="([^"]*)"/)?.[1], value = match[0].match(/value="([^"]*)"/)?.[1] || "";
    if (name && (name.startsWith("$ACTION") || match[0].includes('type="hidden"'))) body.set(name.replace(/&amp;/g, "&"), value.replace(/&amp;/g, "&"));
  }
  return body;
}
try {
  const category = await prisma.category.create({ data: { slug: prefix, name: prefix, visible: true } }); categoryId = category.id;
  const products = [];
  for (let index = 0; index < 3; index++) {
    const product = await prisma.product.create({ data: { name: "QA Чаша", sku: `${prefix}-${index}`, slug: `${prefix}-${index}`, basePrice: 100 + index, stock: index + 1, status: index === 2 ? "DRAFT" : "PUBLISHED", categories: { create: { categoryId, isPrimary: true } }, images: { create: { path: "/generated/product-organizer.webp", alt: "QA", sortOrder: 0 } } } });
    ids.push(product.id); products.push(product);
  }
  const login = await form("/login/", 'name="email"'); login.set("email", "qa@example.test"); login.set("password", "LocalGalleryQA-2026");
  assert.equal((await request("/login/", login)).headers.get("location"), "/account/");
  for (const [index, product] of products.entries()) {
    const path = `/admin/products/${product.id}/`, body = await form(path, 'name="groupId"');
    body.set("mode", "MANUAL"); body.set("groupId", groupId ?? ""); body.set("newName", index === 0 ? prefix : ""); body.set("label", ["зелёный", "белый", "секретный черновик"][index]);
    assert.equal((await request(path, body)).headers.get("location"), `${path}?saved=1`);
    groupId = (await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).groupId!;
  }
  const publicPath = `/catalog/${category.slug}/${products[0].slug}/`;
  let html = await (await request(publicPath, undefined, false)).text();
  const section = html.match(/<section class="product-group-options"[\s\S]*?<\/section>/)?.[0]; assert(section);
  assert(section.includes('aria-current="page"') && section.includes(products[1].slug));
  assert(!section.includes(products[2].slug) && !section.includes("секретный черновик"));
  const variantPath = `/catalog/${category.slug}/${products[1].slug}/`;
  const purchase = await form(variantPath, 'name="productId"'); purchase.set("quantity", "1");
  assert.equal(purchase.get("productId"), products[1].id);
  assert.equal((await request(variantPath, purchase)).headers.get("location"), "/cart/");
  const item = await prisma.cartItem.findFirstOrThrow({ where: { productId: products[1].id } }); cartId = item.cartId;
  assert.equal(Number(item.unitPrice), 101); assert.equal(await prisma.cartItem.count({ where: { productId: products[0].id } }), 0);
  const adminPath = `/admin/products/${products[1].id}/`, detach = await form(adminPath, 'name="groupId"');
  detach.set("groupId", ""); detach.set("newName", ""); detach.set("label", ""); detach.set("mode", "MANUAL");
  assert.match((await request(adminPath, detach, false)).headers.get("location") ?? "", /^\/login/);
  assert([400, 403, 500].includes((await request(adminPath, detach, true, "https://foreign.invalid")).status));
  assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: products[1].id } })).groupId, groupId);
  const user = await prisma.user.findUniqueOrThrow({ where: { email: "qa@example.test" } }), roles = await prisma.userRole.findMany({ where: { userId: user.id } });
  try {
    await prisma.userRole.deleteMany({ where: { userId: user.id } });
    assert.match((await request(adminPath, detach)).headers.get("location") ?? "", /forbidden/);
  } finally { await prisma.userRole.createMany({ data: roles, skipDuplicates: true }); }
  assert.equal((await request(adminPath, detach)).headers.get("location"), `${adminPath}?saved=1`);
  const detached = await prisma.product.findUniqueOrThrow({ where: { id: products[1].id } }); assert.equal(detached.groupId, null); assert.equal(detached.groupingMode, "MANUAL");
  html = await (await request(publicPath, undefined, false)).text(); assert(!html.includes('<section class="product-group-options"'));
  console.log("PASS: admin group creation/join/removal, photo variant links, selected state, draft privacy, separate variant price/cart identity, anonymous/permission/CSRF denial. Local fixtures only.");
} finally {
  if (cartId) await prisma.cart.deleteMany({ where: { id: cartId } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: ids }, action: "product.group.update" } });
  await prisma.product.deleteMany({ where: { id: { in: ids } } });
  if (groupId) await prisma.productGroup.deleteMany({ where: { id: groupId } });
  if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.$disconnect();
}
