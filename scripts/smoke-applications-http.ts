// Local synthetic QA only. Never calls a bank, cashbox, email or carrier API.
import assert from "node:assert/strict";
import { assertInlineCheckoutError } from "./assert-inline-checkout-error";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { purchasedProductWhere } from "../src/lib/reviews";
import { OZON_DELIVERY_SETTING } from "../src/lib/delivery/ozon-config";
import { createGuestGrant } from "../src/lib/guest-order-grant";

const base = new URL(process.env.SMOKE_BASE_URL || "http://localhost:3101"), db = new URL(process.env.DATABASE_URL || "");
assert(["localhost", "127.0.0.1"].includes(base.hostname) && ["localhost", "127.0.0.1"].includes(db.hostname) && db.pathname === "/shop_qa");
assert(!process.env.RESEND_API_KEY, "No email provider allowed in this smoke test");
const anon = new Map<string, string>(), buyer = new Map<string, string>(), other = new Map<string, string>(), staff = new Map<string, string>();
const userIds: string[] = [], orderIds: string[] = [], cartIds: string[] = [];
const temporaryGrantNumbers: string[] = [];
const prefix = `qa-application-${randomUUID().slice(0, 8)}`;
const keys = ["legal.seller", "legal.address", "contacts.email", OZON_DELIVERY_SETTING];
const oldSettings = await prisma.siteSetting.findMany({ where: { key: { in: keys } } });
let categoryId = "", productId = "", methodId = "";
async function request(path: string, body?: FormData, jar = anon, origin = base.origin) {
  const response = await fetch(new URL(path, base), { method: body ? "POST" : "GET", redirect: "manual", headers: { Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; "), ...(body ? { Origin: origin } : {}) }, body, signal: AbortSignal.timeout(20000) });
  for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(";")[0], index = pair.indexOf("="); jar.set(pair.slice(0, index), pair.slice(index + 1)); }
  return response;
}
function actionForm(html: string, needle: string) {
  const markup = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(match => match[0]).find(value => value.includes(needle)); assert(markup, `Missing form ${needle}`);
  const result = new FormData(), decode = (value: string) => value.replace(/&amp;/g, "&").replace(/&quot;/g, '"');
  for (const match of markup.matchAll(/<input\b[^>]*>/g)) { const name = match[0].match(/name="([^"]*)"/)?.[1], value = match[0].match(/value="([^"]*)"/)?.[1] ?? ""; if (name && (name.startsWith("$ACTION") || match[0].includes('type="hidden"'))) result.set(decode(name), decode(value)); }
  return result;
}
async function session(jar: Map<string, string>, admin = false) {
  const user = await prisma.user.create({ data: { email: `${prefix}-${randomUUID()}@example.test`, name: "Synthetic buyer", passwordHash: "!qa-only", ...(admin ? { roles: { create: { role: { connect: { code: "superadmin" } } } } } : {}) } }); userIds.push(user.id);
  const token = randomUUID(); await prisma.session.create({ data: { userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 3600000) } }); jar.set("3dp_session", token); return user;
}
try {
  for (const [key, value] of Object.entries({ "legal.seller": "Synthetic QA operator", "legal.address": "Synthetic QA address", "contacts.email": "operator@example.test" })) await prisma.siteSetting.upsert({ where: { key }, create: { key, value, group: "legal" }, update: { value } });
  const disabledOzon = { enabled: false, clientId: "", clientSecret: "", shipmentMethodId: null, dispatchDays: 1 };
  await prisma.siteSetting.upsert({ where: { key: OZON_DELIVERY_SETTING }, create: { key: OZON_DELIVERY_SETTING, group: "integrations", value: disabledOzon }, update: { value: disabledOzon } });
  const owner = await session(buyer); await session(other); await session(staff, true);
  const category = await prisma.category.create({ data: { name: "QA application", slug: prefix, visible: true } }); categoryId = category.id;
  const product = await prisma.product.create({ data: { name: "QA товар для заявки", sku: prefix, slug: prefix, type: "READY", basePrice: 250, status: "PUBLISHED", stock: 10, madeToOrder: false, categories: { create: { categoryId, isPrimary: true } } } }); productId = product.id;
  const method = await prisma.deliveryMethod.create({ data: { code: prefix, name: "QA delivery preference", active: true, basePrice: 125 } }); methodId = method.id;
  const cart = await prisma.cart.create({ data: { userId: owner.id, items: { create: { productId, quantity: 2, unitPrice: 250, config: {} } } } }); cartIds.push(cart.id);
  const checkoutResponse = await request("/checkout/", undefined, buyer); assert.equal(checkoutResponse.status, 200, `Checkout redirected to ${checkoutResponse.headers.get("location")}`);
  const checkoutHtml = await checkoutResponse.text();
  assert(checkoutHtml.includes("Отправить заявку"), checkoutHtml.match(/<button\b[^>]*type="submit"[^>]*>[\s\S]*?<\/button>/g)?.join(" | ") ?? checkoutHtml.slice(0, 600)); assert(!checkoutHtml.includes('name="payment"')); assert(!checkoutHtml.includes("По счёту") && !checkoutHtml.includes("Онлайн-оплата · Точка"));
  const form = actionForm(checkoutHtml, 'name="expectedTotal"');
  for (const [key, value] of Object.entries({ name: "Synthetic buyer", email: owner.email, phone: "+79991234567", delivery: prefix, city: "Москва", address: "QA улица, 1", legal: "on", expectedTotal: "500", payment: "tochka", comment: "QA contact request only" })) form.set(key, value);
  const invalid = new FormData(); for (const [key, value] of form) invalid.append(key, value); invalid.delete("legal");
  await assertInlineCheckoutError(await request("/checkout/", invalid, buyer), "invalid");
  const forged = new FormData(); for (const [key, value] of form) forged.append(key, value); forged.set("expectedTotal", "1");
  await assertInlineCheckoutError(await request("/checkout/", forged, buyer), "price");
  assert((await request("/checkout/", form, buyer, "https://foreign.invalid")).status >= 400);
  const responses = await Promise.all([request("/checkout/", form, buyer), request("/checkout/", form, buyer)]);
  const success = responses.find(response => response.headers.get("location")?.includes("/checkout/success/")); assert(success);
  const number = success.headers.get("location")!.split("/")[3];
  const order = await prisma.order.findUniqueOrThrow({ where: { number }, include: { payment: true, shipment: { include: { ozonJob: true } }, fiscalReceipts: true } }); orderIds.push(order.id);
  assert.equal(await prisma.order.count({ where: { userId: owner.id } }), 1); assert.equal(await prisma.cartItem.count({ where: { cartId: cart.id } }), 0);
  assert.equal(order.kind, "APPLICATION"); assert.equal(order.status, "NEW"); assert.equal(order.payment, null); assert.equal(order.fiscalReceipts.length, 0); assert.equal(order.shipment?.ozonJob, null);
  assert.equal(Number(order.total), 500); assert.equal(Number(order.deliveryPrice), 0); assert.equal(Number(order.shipment?.cost), 125);
  assert.equal(order.userId, owner.id); assert.equal(order.purchaseConfirmedAt, null);
  assert(await prisma.auditLog.findFirst({ where: { entityId: order.id, action: "order.application.create" } }));
  const confirmation = await (await request(`/checkout/success/${number}/`, undefined, buyer)).text(); assert(confirmation.includes("Заявка принята") && !confirmation.includes("Оплатить заказ"));
  assert.equal((await request(`/checkout/success/${number}/`, undefined, other)).status, 404);
  assert.equal((await request(`/checkout/success/${number}/`)).status, 404);
  const account = await (await request("/account/", undefined, staff)).text(); assert(account.includes("Заявки покупателей"));
  const list = await (await request("/admin/orders/?status=NEW", undefined, staff)).text(); assert(list.includes(number) && list.includes("Новая заявка"));
  assert.equal((await request("/admin/orders/?status=invalid-status", undefined, staff)).status, 200);
  const path = `/admin/orders/${number}/`, markup = await (await request(path, undefined, staff)).text(); assert(markup.includes("Обработка заявки") && !markup.includes('value="AWAITING_PAYMENT"'));
  const status = actionForm(markup, 'name="status"'); status.set("status", "IN_PROGRESS"); status.set("note", "QA manual follow-up");
  assert.match((await request(path, status, other)).headers.get("location")!, /forbidden/);
  assert.match((await request(path, status)).headers.get("location")!, /login/);
  assert((await request(path, status, staff, "https://foreign.invalid")).status >= 400);
  assert.match((await request(path, status, staff)).headers.get("location")!, /saved=1/);
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "IN_PROGRESS");
  assert.equal(await prisma.order.count({ where: purchasedProductWhere(owner.id, productId) }), 0);
  status.set("status", "PAID"); assert.match((await request(path, status, staff)).headers.get("location")!, /application-status/);
  status.set("status", "DELIVERED"); assert.match((await request(path, status, staff)).headers.get("location")!, /application-status/);
  status.set("purchaseConfirmed", "on"); assert.match((await request(path, status, staff)).headers.get("location")!, /saved=1/);
  assert.equal(await prisma.order.count({ where: purchasedProductWhere(owner.id, productId) }), 1);
  assert.equal(await prisma.payment.count({ where: { orderId: order.id } }), 0); assert.equal(await prisma.fiscalReceipt.count({ where: { orderId: order.id } }), 0);
  // Synthetic outbox: deletion must durably request cancellation, never invoke
  // a carrier from the HTTP action or erase its reconciliation history.
  const ozonJob = await prisma.ozonDeliveryJob.create({ data: { shipmentId: order.shipment!.id, clientId: "qa-only", request: { postings: [{ request_id: 1 }] }, status: "CREATED", attempts: 1, response: { order_number: "qa-only", postings: [{ request_id: 1, posting_number: "qa-only-posting" }] } } });
  const deletion = actionForm(markup, "Да, удалить заказ"); deletion.set("confirmation", "wrong-order");
  assert.match((await request(path, deletion, staff)).headers.get("location")!, /confirmation/);
  deletion.set("confirmation", number);
  assert.match((await request(path, deletion, other)).headers.get("location")!, /forbidden/);
  assert((await request(path, deletion, staff, "https://foreign.invalid")).status >= 400);
  assert.match((await request(path, deletion, staff)).headers.get("location")!, /deleted=/);
  assert((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).deletedAt);
  assert((await prisma.ozonDeliveryJob.findUniqueOrThrow({ where: { id: ozonJob.id } })).cancelRequestedAt);
  assert.equal((await prisma.ozonDeliveryJob.findUniqueOrThrow({ where: { id: ozonJob.id } })).status, "CREATED", "No premature remote cancellation success");
  assert((await (await request(path, undefined, staff)).text()).includes("Отмена запрошена"));
  assert(!(await (await request("/admin/orders/", undefined, staff)).text()).includes(number));
  assert((await (await request("/admin/orders/?view=deleted", undefined, staff)).text()).includes(number));
  assert(!(await (await request("/account/orders/", undefined, buyer)).text()).includes(number));
  assert.equal((await request(`/account/orders/${number}/`, undefined, buyer)).status, 404);
  assert.equal((await request(`/checkout/success/${number}/`, undefined, buyer)).status, 404);
  assert.match((await request(path, status, staff)).headers.get("location")!, /missing/);
  assert.match((await request(path, deletion, staff)).headers.get("location")!, /missing/);
  assert.equal(await prisma.auditLog.count({ where: { entityId: order.id, action: "order.delete" } }), 1);
  // Guests receive an order-scoped access cookie, never ownership by email.
  const guestKey = randomUUID(), guestCart = await prisma.cart.create({ data: { sessionKey: guestKey, items: { create: { productId, quantity: 1, unitPrice: 250, config: {} } } } }); cartIds.push(guestCart.id); anon.set("3dp_cart", guestKey);
  const guestForm = actionForm(await (await request("/checkout/")).text(), 'name="expectedTotal"');
  for (const [key, value] of Object.entries({ name: "QA guest", email: "guest@example.test", phone: "+79991234567", delivery: prefix, city: "Москва", address: "QA guest address", legal: "on", expectedTotal: "250" })) guestForm.set(key, value);
  const guestResponse = await request("/checkout/", guestForm), guestLocation = guestResponse.headers.get("location")!; assert(guestLocation.includes("/checkout/success/"));
  const guestOrder = await prisma.order.findUniqueOrThrow({ where: { number: guestLocation.split("/")[3] } }); orderIds.push(guestOrder.id);
  assert.equal(guestOrder.userId, null); assert.equal((await request(guestLocation)).status, 200); assert.equal((await request(guestLocation, undefined, other)).status, 404);
  // A guest returning from payment sees only the order authorized by this browser.
  const pendingNumber = `3DP-301101-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  const pendingGuest = await prisma.order.create({ data: { number: pendingNumber, kind: "ORDER", status: "AWAITING_PAYMENT", reservationExpiresAt: new Date(Date.now() + 600_000), customerName: "QA", customerEmail: "qa@example.test", customerPhone: "+79990000000", subtotal: 250, total: 250, items: { create: { productId, productName: "QA item", quantity: 1, unitPrice: 250, totalPrice: 250 } }, payment: { create: { provider: "yookassa-online", amount: 250, status: "PENDING" } } } }); orderIds.push(pendingGuest.id);
  const grant = await createGuestGrant(prisma, pendingNumber); temporaryGrantNumbers.push(pendingNumber);
  const guestPay = new Map([[`3dp_order_${pendingNumber}`, grant]]), forgedPay = new Map([[`3dp_order_${pendingNumber}`, "forged"]]);
  assert(!(await (await request("/cart/", undefined, forgedPay)).text()).includes(pendingNumber));
  const pendingCart = await (await request("/cart/", undefined, guestPay)).text();
  assert(pendingCart.includes(pendingNumber) && pendingCart.includes("Перейти к оплате"));
  assert.equal((await request(`/checkout/success/${pendingNumber}/`, undefined, guestPay)).status, 200);
  assert.equal((await request(`/checkout/success/${pendingNumber}/`, undefined, forgedPay)).status, 404);
  await prisma.order.update({ where: { id: pendingGuest.id }, data: { reservationExpiresAt: new Date(Date.now() - 1000) } });
  assert(!(await (await request("/cart/", undefined, guestPay)).text()).includes(pendingNumber), "An expired payment is never offered again");
  const pendingOwnerNumber = `3DP-301101-${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
  const pendingOwner = await prisma.order.create({ data: { number: pendingOwnerNumber, userId: owner.id, kind: "ORDER", status: "AWAITING_PAYMENT", reservationExpiresAt: new Date(Date.now() + 600_000), customerName: "QA", customerEmail: "qa@example.test", customerPhone: "+79990000000", subtotal: 250, total: 250, payment: { create: { provider: "yookassa-online", amount: 250, status: "PENDING" } } } }); orderIds.push(pendingOwner.id);
  const ownerPage = await (await request("/account/", undefined, buyer)).text();
  assert(ownerPage.includes(`aria-label="Оплатить заказ ${pendingOwnerNumber}"`));
  assert(ownerPage.includes('data-order-status="AWAITING_PAYMENT"'));
  const ownerOrders = await (await request("/account/orders/", undefined, buyer)).text();
  assert(ownerOrders.includes(`aria-label="Оплатить заказ ${pendingOwnerNumber}"`));
  assert(ownerOrders.includes('data-order-status="AWAITING_PAYMENT"'));
  assert((await (await request(`/account/orders/${pendingOwnerNumber}/`, undefined, buyer)).text()).includes("Перейти к оплате"));
  assert.equal((await request(`/account/orders/${pendingOwnerNumber}/`, undefined, other)).status, 404);
  await prisma.order.update({ where: { id: pendingOwner.id }, data: { status: "CANCELED" } });
  const canceledOwnerPage = await (await request("/account/", undefined, buyer)).text();
  assert(canceledOwnerPage.includes('data-order-status="CANCELED"'));
  assert(!canceledOwnerPage.includes(`aria-label="Оплатить заказ ${pendingOwnerNumber}"`));
  console.log("PASS applications HTTP: buyer/guest contact requests without payments/receipts, custom delivery without carrier calls, forged/stale payment ignored, validation / price / CSRF / duplicate protection, manual statuses / purchase attestation, scoped access, confirmed archival with durable Ozon cancellation intent / retained history, active and deleted lists. No external APIs.");
} finally {
  await prisma.auditLog.deleteMany({ where: { entityId: { in: orderIds } } });
  await prisma.guestOrderGrant.deleteMany({ where: { orderNumber: { in: temporaryGrantNumbers } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.cart.deleteMany({ where: { id: { in: cartIds } } });
  await prisma.privacyConsent.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  if (productId) await prisma.product.deleteMany({ where: { id: productId } });
  if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });
  if (methodId) await prisma.deliveryMethod.deleteMany({ where: { id: methodId } });
  for (const key of keys) { const old = oldSettings.find(row => row.key === key); if (old) await prisma.siteSetting.update({ where: { key }, data: { value: old.value === null ? Prisma.JsonNull : old.value as Prisma.InputJsonValue } }); else await prisma.siteSetting.deleteMany({ where: { key } }); }
  await prisma.$disconnect();
}
