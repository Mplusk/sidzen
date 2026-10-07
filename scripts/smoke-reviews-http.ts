// Disposable synthetic local QA only; no provider APIs or real purchases.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { prisma } from "../src/lib/prisma";
import { REVIEW_CONSENT_VERSION } from "../src/lib/reviews";

const base = new URL(process.env.SMOKE_BASE_URL || "http://localhost:3101"), db = new URL(process.env.DATABASE_URL || "");
assert(["localhost", "127.0.0.1"].includes(base.hostname) && ["localhost", "127.0.0.1"].includes(db.hostname) && db.pathname === "/shop_qa", "Disposable local shop_qa only");
const anon = new Map<string, string>(), buyer = new Map<string, string>(), outsider = new Map<string, string>(), staff = new Map<string, string>();
const userIds: string[] = [], orderIds: string[] = [], reviewIds: string[] = [], photoFiles: string[] = [];
const settingKeys = ["legal.seller", "legal.address", "contacts.email"], originalSettings = await prisma.siteSetting.findMany({ where: { key: { in: settingKeys } } });
let productId = "", otherProductId = "", categoryId = "";
const decode = (value: string) => value.replace(/&amp;/g, "&").replace(/&quot;/g, '"');
async function request(path: string, body?: FormData, jar = anon, origin = base.origin) {
  const response = await fetch(new URL(path, base), { method: body ? "POST" : "GET", redirect: "manual", headers: { Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; "), ...(body ? { Origin: origin } : {}) }, body, signal: AbortSignal.timeout(20000) });
  for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(";")[0], index = pair.indexOf("="); jar.set(pair.slice(0, index), pair.slice(index + 1)); }
  return response;
}
function actionForm(html: string, needle: string) {
  const markup = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(match => match[0]).find(value => value.includes(needle)); assert(markup, `Missing form ${needle}`);
  const result = new FormData();
  for (const match of markup.matchAll(/<input\b[^>]*>/g)) { const name = match[0].match(/name="([^"]*)"/)?.[1], value = match[0].match(/value="([^"]*)"/)?.[1] ?? ""; if (name && (name.startsWith("$ACTION") || match[0].includes('type="hidden"'))) result.set(decode(name), decode(value)); }
  return result;
}
async function session(jar: Map<string, string>, admin = false) {
  const user = await prisma.user.create({ data: { email: `qa-reviews-${randomUUID()}@example.test`, name: "DO NOT PUBLISH FULL ACCOUNT NAME", passwordHash: "!qa-only", ...(admin ? { roles: { create: { role: { connect: { code: "superadmin" } } } } } : {}) } }); userIds.push(user.id);
  const token = randomUUID(); await prisma.session.create({ data: { userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3600000) } }); jar.set("3dp_session", token); return user;
}
const path = "/account/reviews/", moderation = "/account/review-moderation/";
try {
  for (const [key, value] of Object.entries({ "legal.seller": "Synthetic QA operator", "legal.address": "Synthetic QA address", "contacts.email": "operator@example.test" })) await prisma.siteSetting.upsert({ where: { key }, create: { key, value, group: "legal" }, update: { value } });
  const owner = await session(buyer), other = await session(outsider); await session(staff, true);
  const slug = `qa-reviews-${randomUUID().slice(0, 8)}`;
  const category = await prisma.category.create({ data: { name: "QA reviews", slug, visible: true } }); categoryId = category.id;
  const product = await prisma.product.create({ data: { name: "Товар для проверки отзывов", sku: slug, slug, basePrice: 250, status: "PUBLISHED", stock: 5, categories: { create: { categoryId, isPrimary: true } } } }); productId = product.id;
  const otherProduct = await prisma.product.create({ data: { name: "Не купленный товар", sku: `${slug}-other`, slug: `${slug}-other`, basePrice: 100, status: "PUBLISHED" } }); otherProductId = otherProduct.id;
  const order = await prisma.order.create({ data: { number: slug, userId: owner.id, status: "DELIVERED", customerName: "Private QA recipient", customerEmail: owner.email, customerPhone: "+79990000000", subtotal: 250, total: 250, items: { create: { productId, productName: product.name, quantity: 1, unitPrice: 250, totalPrice: 250 } }, payment: { create: { provider: "qa-local-only", status: "PAID", amount: 250 } } } }); orderIds.push(order.id);
  const productPath = `/catalog/${slug}/${slug}/`;
  const anonymous = await (await request(productPath)).text(); assert(anonymous.includes("Отзывы доступны всем") && !anonymous.includes('name="author"'));
  assert.match((await request(path)).headers.get("location")!, /login/);
  assert.match((await request(moderation, undefined, outsider)).headers.get("location")!, /forbidden/);
  let html = await (await request(path, undefined, buyer)).text(); assert(html.includes(product.name) && html.includes('name="author"') && !html.includes(otherProduct.name));
  const original = actionForm(html, 'name="author"');
  function reviewInput() { const data = new FormData(); for (const [key, value] of original) data.append(key, value); data.set("author", "QA Покупатель"); data.set("rating", "5"); data.set("text", "QA_PUBLIC_REVIEW_TEXT — удобный и качественный товар"); data.set("consent", "on"); data.set("userId", other.id); data.set("orderId", order.id); return data; }
  assert.match((await request(path, reviewInput())).headers.get("location")!, /login/);
  assert.match((await request(path, reviewInput(), outsider)).headers.get("location")!, /error=purchase/);
  const forgedProduct = reviewInput(); forgedProduct.set("productId", otherProductId); assert.match((await request(path, forgedProduct, buyer)).headers.get("location")!, /error=purchase/);
  for (const state of ["SHIPPED", "CANCELED", "REFUNDED"] as const) { await prisma.order.update({ where: { id: order.id }, data: { status: state } }); assert.match((await request(path, reviewInput(), buyer)).headers.get("location")!, /error=purchase/); }
  await prisma.order.update({ where: { id: order.id }, data: { status: "DELIVERED" } });
  await prisma.payment.update({ where: { orderId: order.id }, data: { status: "PENDING" } }); assert.match((await request(path, reviewInput(), buyer)).headers.get("location")!, /error=purchase/);
  await prisma.payment.update({ where: { orderId: order.id }, data: { status: "PAID", refundReviewRequired: true } }); assert.match((await request(path, reviewInput(), buyer)).headers.get("location")!, /error=purchase/);
  await prisma.payment.update({ where: { orderId: order.id }, data: { refundReviewRequired: false } });
  const withoutConsent = reviewInput(); withoutConsent.delete("consent"); assert.match((await request(path, withoutConsent, buyer)).headers.get("location")!, /error=invalid/);
  const badImage = reviewInput(); badImage.append("photos", new File(["fake-jpeg"], "photo.jpg", { type: "image/jpeg" })); assert.match((await request(path, badImage, buyer)).headers.get("location")!, /error=images/);
  const overCount = reviewInput(); for (let i = 0; i < 6; i++) overCount.append("photos", new File(["x"], "a.png", { type: "image/png" })); assert.match((await request(path, overCount, buyer)).headers.get("location")!, /error=images/);
  assert((await request(path, reviewInput(), buyer, "https://foreign.invalid")).status >= 400); assert.equal(await prisma.review.count({ where: { productId } }), 0);
  const photo = await sharp({ create: { width: 80, height: 60, channels: 3, background: "blue" } }).withMetadata().jpeg().toBuffer();
  const withPhotos = () => { const data = reviewInput(); data.append("photos", new File([new Uint8Array(photo)], "private-name.jpg", { type: "image/jpeg" })); data.append("photos", new File([new Uint8Array(photo)], "second.jpg", { type: "image/jpeg" })); return data; };
  const results = await Promise.all([request(path, withPhotos(), buyer), request(path, withPhotos(), buyer)]);
  assert(results.some(response => response.headers.get("location")?.includes("sent=1"))); assert(results.some(response => response.headers.get("location")?.includes("error=duplicate")));
  assert.equal(await prisma.review.count({ where: { productId, userId: owner.id } }), 1);
  const review = await prisma.review.findFirstOrThrow({ where: { productId, userId: owner.id }, include: { images: true, consent: true } }); reviewIds.push(review.id); photoFiles.push(...review.images.map(image => image.fileName));
  assert.equal(review.consent?.version, REVIEW_CONSENT_VERSION);
  assert.equal(review.status, "PENDING"); assert.equal(review.approved, false); assert.equal(review.verifiedPurchase, true); assert.equal(review.images.length, 2); assert.equal(review.consent?.purpose, "review");
  assert(!((await (await request(productPath)).text()).includes("QA_PUBLIC_REVIEW_TEXT")));
  const photoPath = `/api/review-images/${review.images[0].id}/`;
  assert.equal((await request(photoPath)).status, 404); assert.equal((await request(photoPath, undefined, outsider)).status, 404);
  const ownImage = await request(photoPath, undefined, buyer); assert.equal(ownImage.status, 200); assert(ownImage.headers.get("cache-control")?.includes("no-store")); const metadata = await sharp(Buffer.from(await ownImage.arrayBuffer())).metadata(); assert.equal(metadata.format, "webp"); assert.equal(metadata.exif, undefined);
  assert.equal((await request(photoPath, undefined, staff)).status, 200);
  html = await (await request(moderation, undefined, staff)).text(); const approve = actionForm(html, review.id); approve.set("decision", "PUBLISHED");
  assert.match((await request(moderation, approve, outsider)).headers.get("location")!, /forbidden/);
  assert.match((await request(moderation, approve, staff)).headers.get("location")!, /saved=1/);
  const published = (await (await request(productPath)).text()).replace(/<!--[\s\S]*?-->/g, ""); assert(published.includes("QA_PUBLIC_REVIEW_TEXT") && published.includes("Товар куплен") && published.includes('"reviewCount":1'));
  for (const privateValue of [owner.email, "DO NOT PUBLISH FULL ACCOUNT NAME", "Private QA recipient", "private-name.jpg", review.images[0].fileName]) assert(!published.includes(privateValue));
  assert.equal((await request(photoPath)).status, 200);
  // Alias requests hit the same disposable application/DB, not the real domain.
  const aliasRequest = (target: string) => fetch(new URL(target, base), { headers: { Host: "sidzen.shop", "X-Forwarded-Host": "sidzen.shop" }, redirect: "manual" });
  assert((await (await aliasRequest(productPath)).text()).includes("QA_PUBLIC_REVIEW_TEXT"));
  assert.equal((await aliasRequest(photoPath)).status, 200);
  assert(review.consentId);
  await prisma.privacyConsent.update({ where: { id: review.consentId }, data: { version: "2026-10-06-reviews-v1" } });
  assert(!((await (await aliasRequest(productPath)).text()).includes("QA_PUBLIC_REVIEW_TEXT")), "Single-domain consent must not publish on SIDZEN");
  assert.equal((await aliasRequest(photoPath)).status, 404);
  assert((await (await request(productPath)).text()).includes("QA_PUBLIC_REVIEW_TEXT"), "Old consent remains valid on its original domain");
  await prisma.privacyConsent.update({ where: { id: review.consentId }, data: { version: REVIEW_CONSENT_VERSION } });
  // More than one page: aggregate must use all rows, not just latest ten.
  await prisma.review.createMany({ data: Array.from({ length: 10 }, (_, i) => ({ id: `${slug}-${i}`, productId, author: "QA historical", text: `QA_PAGE_${i}`, rating: 1, approved: true, status: "PUBLISHED" })) });
  const pageOne = await (await request(productPath)).text(), pageTwo = await (await request(`${productPath}?reviewsPage=2`)).text(); assert(pageOne.includes('"reviewCount":11') && pageOne.includes('"ratingValue":"1.4"')); assert(pageOne.includes("Следующие отзывы") && pageTwo.includes("Предыдущие отзывы"));
  const exporting = await (await request("/api/account/personal-data/", undefined, buyer)).json(); assert.equal(exporting.reviews.length, 1); assert.equal(exporting.reviews[0].author, "QA Покупатель"); assert(!JSON.stringify(exporting.reviews).includes(review.images[0].fileName));
  const withdrawal = actionForm(await (await request("/account/privacy/", undefined, buyer)).text(), 'name="type"'); withdrawal.set("type", "WITHDRAW"); withdrawal.set("message", "Отзываю разрешение на публикацию отзыва"); assert.match((await request("/account/privacy/", withdrawal, buyer)).headers.get("location")!, /sent=1/);
  assert.equal((await request(photoPath)).status, 404); assert(!((await (await request(productPath)).text()).includes("QA_PUBLIC_REVIEW_TEXT")));
  assert.match((await request(moderation, approve, staff)).headers.get("location")!, /error=consent/);
  html = await (await request(path, undefined, buyer)).text(); const deletion = actionForm(html, 'name="reviewId"'); deletion.delete("confirmation"); assert.match((await request(path, deletion, buyer)).headers.get("location")!, /error=confirmation/);
  deletion.set("confirmation", "delete-review"); assert.match((await request(path, deletion, outsider)).headers.get("location")!, /error=missing/);
  assert.match((await request(path, deletion, buyer)).headers.get("location")!, /deleted=1/); assert.equal(await prisma.review.count({ where: { id: review.id } }), 0); assert.equal((await request(photoPath, undefined, buyer)).status, 404);
  for (const file of photoFiles) await assert.rejects(stat(join(process.cwd(), "private-uploads", "reviews", file)), { code: "ENOENT" });
  console.log("PASS: anonymous/foreign-buyer/unpaid/undelivered/refunded/spoofed/CSRF denial; concurrent review dedup; explicit publication consent; two real photos + metadata stripping; pending photo ACL; moderator approval; public review/rating/photo without account data; all-row aggregate + pagination; scoped export; withdrawal prevents republish; confirmed own deletion removes files. Only isolated synthetic QA orders/payments, no provider APIs.");
} finally {
  const { unlink } = await import("node:fs/promises");
  for (const file of photoFiles) await unlink(join(process.cwd(), "private-uploads", "reviews", file)).catch(() => undefined);
  await prisma.auditLog.deleteMany({ where: { entityType: "Review", entityId: { in: reviewIds } } });
  if (productId) await prisma.product.deleteMany({ where: { id: productId } }); if (otherProductId) await prisma.product.deleteMany({ where: { id: otherProductId } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.privacyConsent.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } }); if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });
  for (const key of settingKeys) { const previous = originalSettings.find(row => row.key === key); if (previous) await prisma.siteSetting.update({ where: { key }, data: { value: previous.value!, group: previous.group } }); else await prisma.siteSetting.deleteMany({ where: { key } }); }
  await prisma.$disconnect();
}
