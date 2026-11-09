import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access, mkdir, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma";
import { deleteProduct } from "../src/lib/product-delete";
import { applySnapshot, marketplaceLock } from "../src/lib/marketplaces/sync";
import { reviewImagePath } from "../src/lib/review-images";

const base = new URL(process.env.SMOKE_BASE_URL || "http://localhost:3101"), db = new URL(process.env.DATABASE_URL || "");
assert(["localhost", "127.0.0.1"].includes(base.hostname) && ["localhost", "127.0.0.1"].includes(db.hostname) && db.pathname === "/shop_qa");
const prefix = `qa-delete-${randomUUID().slice(0, 8)}`, jar = new Map<string, string>();
const ids: string[] = [], files: string[] = [];
let orderId: string | undefined, cartId: string | undefined, runId: string | undefined, groupId: string | undefined;
const decode = (value: string) => value.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
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
  const actor = await prisma.user.findUniqueOrThrow({ where: { email: "qa@example.test" } }), admin = { id: actor.id, canPublish: true };
  groupId = (await prisma.productGroup.create({ data: { name: prefix } })).id;
  const shared = `${randomUUID()}.webp`, unique = `${randomUUID()}.webp`, photo = `${randomUUID()}.webp`;
  const sharedPath = `/uploads/products/${shared}`, uniquePath = `/uploads/products/${unique}`;
  await mkdir(join(process.cwd(), "public/uploads/products"), { recursive: true });
  await mkdir(join(process.cwd(), "private-uploads/reviews"), { recursive: true });
  for (const path of [join(process.cwd(), "public", sharedPath), join(process.cwd(), "public", uniquePath), reviewImagePath(photo)]) { await writeFile(path, Buffer.from("local deletion fixture")); files.push(path); }
  for (const index of [0, 1]) ids.push((await prisma.product.create({ data: { sku: `${prefix}-${index}`, slug: `${prefix}-${index}`, name: `${prefix}-${index}`, basePrice: 599, status: "PUBLISHED", groupId, images: { create: [{ path: sharedPath, alt: prefix }, ...(index === 0 ? [{ path: uniquePath, alt: prefix }] : [])] } } })).id);
  const id = ids[0], path = `/admin/products/${id}/`, input = { id, confirmation: id };
  const variant = await prisma.productVariant.create({ data: { productId: id, sku: `${prefix}-variant`, price: 599 } });
  cartId = (await prisma.cart.create({ data: { sessionKey: prefix, items: { create: [{ productId: id, unitPrice: 599 }, { variantId: variant.id, unitPrice: 599 }] } } })).id;
  orderId = (await prisma.order.create({ data: { number: prefix, status: "DELIVERED", inventoryTracked: false, customerName: "QA", customerPhone: "+70000000000", customerEmail: "qa@example.test", subtotal: 599, total: 599, items: { create: { productId: id, productName: prefix, sku: `${prefix}-0`, unitPrice: 599, totalPrice: 599 } } } })).id;
  const before = await prisma.orderItem.findFirstOrThrow({ where: { orderId } });
  await prisma.productFavorite.create({ data: { userId: actor.id, productId: id } });
  await prisma.review.create({ data: { productId: id, userId: actor.id, rating: 5, author: "QA", text: prefix, images: { create: { fileName: photo, width: 1, height: 1, sortOrder: 0 } } } });
  await prisma.productCategoryAiJob.create({ data: { productId: id } });
  const snapshot = { externalId: "101", sku: `${prefix}-0`, barcodes: [`${prefix}-barcode`], name: prefix, description: null, specifications: null, price: 599, oldPrice: null, images: [], issue: null };
  await prisma.$transaction(async tx => { await marketplaceLock(tx); await applySnapshot(tx, "wb", prefix, snapshot); });
  await assert.rejects(deleteProduct({ ...input, confirmation: "wrong" }, admin), /confirmation/);
  // A historical order must be reconciled, even when already completed.
  await assert.rejects(deleteProduct(input, { ...admin, canPublish: false }), /permission/);
  await assert.rejects(deleteProduct(input, admin), /reserved/);
  assert(await prisma.product.findUnique({ where: { id } }));
  await prisma.order.update({ where: { id: orderId }, data: { inventoryTracked: true } });
  await prisma.product.update({ where: { id }, data: { reservedStock: 1 } });
  await assert.rejects(deleteProduct(input, admin), /reserved/);
  await prisma.product.update({ where: { id }, data: { reservedStock: 0 } });
  await assert.rejects(deleteProduct(input, { ...admin, canPublish: false }), /permission/);
  runId = (await prisma.marketplaceSyncRun.create({ data: { provider: "wb", accountId: prefix } })).id;
  await assert.rejects(deleteProduct(input, admin), /busy/);
  await prisma.marketplaceSyncRun.delete({ where: { id: runId } }); runId = undefined;
  const login = await form("/login/", 'name="email"'); login.set("email", "qa@example.test"); login.set("password", "LocalGalleryQA-2026");
  assert.equal((await request("/login/", login)).headers.get("location"), "/account/");
  const body = await form(path, 'name="confirmation"');
  assert.match((await request(path, body, false)).headers.get("location") ?? "", /^\/login/);
  assert([400, 403, 500].includes((await request(path, body, true, "https://foreign.invalid")).status));
  const roles = await prisma.userRole.findMany({ where: { userId: actor.id } });
  try { await prisma.userRole.deleteMany({ where: { userId: actor.id } }); assert.match((await request(path, body)).headers.get("location") ?? "", /forbidden/); }
  finally { await prisma.userRole.createMany({ data: roles, skipDuplicates: true }); }
  body.set("confirmation", "wrong"); assert.equal((await request(path, body)).headers.get("location"), "/admin/products/?deleteError=confirmation");
  assert(await prisma.product.findUnique({ where: { id } })); body.set("confirmation", id);
  assert.equal((await request(path, body)).headers.get("location"), "/admin/products/?deleted=1");
  assert.equal(await prisma.product.findUnique({ where: { id } }), null);
  for (const count of [await prisma.productVariant.count({ where: { productId: id } }), await prisma.cartItem.count({ where: { cartId } }), await prisma.review.count({ where: { productId: id } }), await prisma.reviewImage.count({ where: { fileName: photo } }), await prisma.productFavorite.count({ where: { productId: id } }), await prisma.productCategoryAiJob.count({ where: { productId: id } }), await prisma.marketplaceIdentity.count({ where: { productId: id } }), await prisma.marketplaceListing.count({ where: { productId: id } })]) assert.equal(count, 0);
  assert.deepEqual(await prisma.orderItem.findUnique({ where: { id: before.id } }), { ...before, productId: null });
  assert(await prisma.order.findUnique({ where: { id: orderId } })); assert(await prisma.product.findUnique({ where: { id: ids[1] } }));
  await access(files[0]); await assert.rejects(access(files[1])); await assert.rejects(access(files[2]));
  assert.equal(await prisma.auditLog.count({ where: { entityId: id, action: "product.delete" } }), 1);
  assert.equal((await request(path)).status, 404);
  await assert.rejects(deleteProduct(input, admin), /missing/);
  const counters = await prisma.$transaction(async tx => { await marketplaceLock(tx); return applySnapshot(tx, "wb", prefix, snapshot); });
  assert.equal(counters.created, 1);
  const imported = await prisma.product.findUniqueOrThrow({ where: { sku: `${prefix}-0`.toUpperCase() } }); ids.push(imported.id);
  assert.notEqual(imported.id, id); assert.equal(imported.status, "DRAFT");
  const repeat = await prisma.$transaction(async tx => { await marketplaceLock(tx); return applySnapshot(tx, "ozon", prefix, { ...snapshot, externalId: "102" }); }); assert.equal(repeat.created, 0);
  assert.equal(await prisma.product.count({ where: { sku: imported.sku } }), 1);
  console.log("PASS: confirmed HTTP deletion, auth/role/CSRF, publication permission, sync guard, database cascades, preserved order snapshot/group member/shared photo, removed owned photos, audit, 404 and WB/Ozon reimport without duplicates.");
} finally {
  if (runId) await prisma.marketplaceSyncRun.deleteMany({ where: { id: runId } });
  await prisma.marketplaceListing.deleteMany({ where: { accountId: prefix } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } });
  if (cartId) await prisma.cart.deleteMany({ where: { id: cartId } });
  if (orderId) await prisma.order.deleteMany({ where: { id: orderId } });
  await prisma.product.deleteMany({ where: { id: { in: ids } } });
  if (groupId) await prisma.productGroup.deleteMany({ where: { id: groupId } });
  for (const path of files) await unlink(path).catch(() => undefined);
  await prisma.$disconnect();
}
