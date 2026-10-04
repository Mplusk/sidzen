import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { decryptSecret, encryptSecret } from "../src/lib/integration-secrets";
import { OZON_DELIVERY_SETTING } from "../src/lib/delivery/ozon-config";

const base = new URL(process.env.SMOKE_BASE_URL || "http://localhost:3101");
const db = new URL(process.env.DATABASE_URL || "");
assert(["localhost", "127.0.0.1"].includes(base.hostname) && ["localhost", "127.0.0.1"].includes(db.hostname) && db.pathname === "/shop_qa");
const jar = new Map<string, string>();
async function request(path: string, body?: FormData, authenticated = true, origin = base.origin) {
  const response = await fetch(new URL(path, base), { method: body ? "POST" : "GET", redirect: "manual", headers: { ...(authenticated ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}), ...(body ? { Origin: origin } : {}) }, body, signal: AbortSignal.timeout(15000) });
  if (authenticated) for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(";")[0], at = pair.indexOf("="); jar.set(pair.slice(0, at), pair.slice(at + 1)); }
  return response;
}
function actionForm(html: string, containing: string) {
  const markup = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(m => m[0]).find(text => text.includes(containing));
  assert(markup, `Missing form ${containing}`);
  const body = new FormData();
  for (const match of markup.matchAll(/<input\b[^>]*>/g)) {
    const name = match[0].match(/name="([^"]*)"/)?.[1], value = match[0].match(/value="([^"]*)"/)?.[1] || "";
    if (name && (name.startsWith("$ACTION") || match[0].includes('type="hidden"'))) body.set(name.replace(/&amp;/g, "&"), value.replace(/&amp;/g, "&"));
  }
  return body;
}
const path = "/account/integrations/", secret = "fixture-delivery-secret-never-public";
const old = await prisma.siteSetting.findUnique({ where: { key: OZON_DELIVERY_SETTING } });
const operatorKeys = ["legal.seller", "legal.address", "contacts.email"];
const oldOperator = await prisma.siteSetting.findMany({ where: { key: { in: operatorKeys } } });
const pointId = "9100000001";
let productId: string | undefined, cartId: string | undefined;
let fixtureOrderId: string | undefined;
const privacyRequests: string[] = [];
let fixtureRole: string | undefined, qaUserId: string | undefined;
let originalRoles: string[] = [];
try {
  for (const [key, value] of [["legal.seller", "QA operator (test only)"], ["legal.address", "QA test address"], ["contacts.email", "operator@example.test"]]) await prisma.siteSetting.upsert({ where: { key }, create: { key, value, group: key.startsWith("legal.") ? "legal" : "contacts" }, update: { value } });
  assert.match((await request(path)).headers.get("location") || "", /^\/login/);
  assert.match((await request("/api/admin/ozon-delivery/label/?jobId=missing&posting=missing", undefined, false)).headers.get("location") || "", /^\/login/);
  const login = actionForm(await (await request("/login/")).text(), 'name="email"');
  login.set("email", "qa@example.test"); login.set("password", "LocalGalleryQA-2026");
  assert.equal((await request("/login/", login)).headers.get("location"), "/account/");
  assert.equal((await request("/api/account/personal-data/", undefined, false)).status, 401);
  const exported = await request("/api/account/personal-data/");
  assert.equal(exported.status, 200); assert.match(exported.headers.get("cache-control") || "", /no-store/);
  const personalData = await exported.text();
  assert(personalData.includes("qa@example.test"));
  for (const privateField of ["passwordHash", "tokenHash", "subjectHash", "internalNote", "clientSecret"]) assert(!personalData.includes(privateField));
  const registration = actionForm(await (await request("/register/")).text(), 'name="password"');
  registration.set("name", "QA"); registration.set("email", "no-consent@example.test"); registration.set("password", "LocalGalleryQA-2026");
  assert.equal((await request("/register/", registration, false)).headers.get("location"), "/register/?error=consent");
  assert.equal(await prisma.user.count({ where: { email: "no-consent@example.test" } }), 0);
  const profile = actionForm(await (await request("/account/profile/")).text(), 'name="company"');
  profile.set("name", "Should not save"); profile.set("phone", ""); profile.set("company", ""); profile.set("taxId", "");
  assert.equal((await request("/account/profile/", profile)).headers.get("location"), "/account/profile/?error=consent");
  const privacyForm = actionForm(await (await request("/account/privacy/")).text(), 'name="message"');
  privacyForm.set("type", "ACCESS"); privacyForm.set("message", "QA request: give processing information"); privacyForm.set("userId", "forged-owner");
  assert.equal((await request("/account/privacy/", privacyForm)).headers.get("location"), "/account/privacy/?sent=1");
  const ownRequest = await prisma.privacyRequest.findFirstOrThrow({ where: { user: { email: "qa@example.test" }, message: "QA request: give processing information" }, orderBy: { createdAt: "desc" } });
  privacyRequests.push(ownRequest.id); assert.notEqual(ownRequest.userId, "forged-owner");
  assert((await (await request("/admin/privacy/")).text()).includes(ownRequest.message));
  const config = { enabled: false, clientId: "fixture-delivery-app", clientSecret: encryptSecret(secret, OZON_DELIVERY_SETTING), shipmentMethodId: 7, dispatchDays: 1, checkedAt: new Date().toISOString(), methodName: "QA active method" };
  const save = async () => prisma.siteSetting.upsert({ where: { key: OZON_DELIVERY_SETTING }, create: { key: OZON_DELIVERY_SETTING, group: "integrations", value: config }, update: { value: config } });
  await save();
  const html = await (await request(path)).text();
  assert(html.includes("Ozon Доставка · Delivery API") && html.includes("fixture-delivery-app"));
  assert(!html.includes(secret) && !html.includes(config.clientSecret));
  assert(!(await (await request("/admin/settings/")).text()).includes(config.clientSecret));
  await prisma.siteSetting.update({ where: { key: OZON_DELIVERY_SETTING }, data: { value: { enabled: false, clientId: config.clientId, clientSecret: config.clientSecret, shipmentMethodId: null, dispatchDays: 1, authorizedAt: new Date().toISOString(), methods: [] } } });
  const noMethodHtml = await (await request(path)).text();
  assert(noMethodHtml.includes("нет активного метода отгрузки") && noMethodHtml.includes("Загрузить методы отгрузки"));
  assert(!noMethodHtml.includes(secret) && !noMethodHtml.includes(config.clientSecret));
  const noMethodForm = actionForm(noMethodHtml, 'name="shipmentMethodId"');
  for (const [key, value] of Object.entries({ clientId: config.clientId, clientSecret: "", shipmentMethodId: "", dispatchDays: "1" })) noMethodForm.set(key, value);
  assert.equal((await request(path, noMethodForm)).headers.get("location"), path + "?result=ozon-no-method#ozon-delivery");
  const unready = (await prisma.siteSetting.findUniqueOrThrow({ where: { key: OZON_DELIVERY_SETTING } })).value as typeof config;
  assert.equal(unready.enabled, false); assert.equal(unready.shipmentMethodId, null);
  assert.equal(decryptSecret(unready.clientSecret, OZON_DELIVERY_SETTING), secret);
  await save();
  const settings = actionForm(html, 'name="shipmentMethodId"'); settings.set("clientId", config.clientId); settings.set("clientSecret", ""); settings.set("shipmentMethodId", "7"); settings.set("dispatchDays", "2");
  assert.equal((await request(path, settings)).headers.get("location"), path + "?result=ozon-verified#ozon-delivery");
  const persisted = (await prisma.siteSetting.findUniqueOrThrow({ where: { key: OZON_DELIVERY_SETTING } })).value as typeof config;
  assert.equal(persisted.dispatchDays, 2); assert.equal(decryptSecret(persisted.clientSecret, OZON_DELIVERY_SETTING), secret);
  settings.set("dispatchDays", "3");
  assert([400, 403, 500].includes((await request(path, settings, true, "https://foreign.invalid")).status));
  assert.equal(((await prisma.siteSetting.findUniqueOrThrow({ where: { key: OZON_DELIVERY_SETTING } })).value as typeof config).dispatchDays, 2);
  const user = await prisma.user.findUniqueOrThrow({ where: { email: "qa@example.test" } });
  qaUserId = user.id;
  originalRoles = (await prisma.userRole.findMany({ where: { userId: user.id } })).map(row => row.roleId);
  const roles = await prisma.userRole.findMany({ where: { userId: user.id } });
  try {
    await prisma.userRole.deleteMany({ where: { userId: user.id } });
    assert.match((await request(path)).headers.get("location") || "", /forbidden/);
    assert.match((await request(path, settings)).headers.get("location") || "", /forbidden/);
  } finally { await prisma.userRole.createMany({ data: roles, skipDuplicates: true }); }
  assert.match((await request(path, settings, false)).headers.get("location") || "", /^\/login/);
  assert.equal((await request("/api/admin/ozon-delivery/label/?jobId=missing&posting=missing")).status, 404);
  assert.deepEqual(await (await request("/api/delivery/ozon/points/?q=Москва", undefined, false)).json(), { points: [] });
  config.enabled = true; await save();
  await prisma.ozonDeliveryPoint.create({ data: { id: pointId, name: "QA ПВЗ", address: "Москва, QA улица, 1", type: "pvz", active: true, clientId: config.clientId, methodId: 7n, generation: "qa-only" } });
  const points = await request("/api/delivery/ozon/points/?q=Москва", undefined, false);
  assert.match(points.headers.get("cache-control") || "", /no-store/);
  assert.deepEqual(await points.json(), { points: [{ id: pointId, name: "QA ПВЗ", address: "Москва, QA улица, 1", type: "pvz" }] });
  const prefix = `qa-delivery-${randomUUID().slice(0, 8)}`;
  const product = await prisma.product.create({ data: { name: "QA Delivery Product", slug: prefix, sku: prefix, type: "READY", status: "PUBLISHED", stock: 10, madeToOrder: false, basePrice: 240, shippingWeightG: 100, shippingLengthMm: 200, shippingWidthMm: 100, shippingHeightMm: 50 } }); productId = product.id;
  const edit = await (await request(`/admin/products/${product.id}/`)).text();
  for (const name of ["shippingWeightG", "shippingLengthMm", "shippingWidthMm", "shippingHeightMm"]) assert(edit.includes(`name="${name}"`));
  const cart = await prisma.cart.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} }); cartId = cart.id;
  await prisma.cartItem.create({ data: { cartId, productId, quantity: 1, unitPrice: 240, config: {} } });
  const checkout = await (await request("/checkout/")).text(); assert(checkout.includes("Ozon Доставка"));
  const order = actionForm(checkout, 'name="expectedTotal"');
  for (const [key, value] of Object.entries({ name: "QA Buyer", phone: "+79991234567", email: "buyer@example.test", delivery: "ozon-delivery", payment: "manual", legal: "on", expectedTotal: "240", ozonQuote: "" })) order.set(key, value);
  const ordersBefore = await prisma.order.count();
  assert.equal((await request("/checkout/", order)).headers.get("location"), "/checkout/?error=invalid");
  assert.equal(await prisma.order.count(), ordersBefore); assert.equal(await prisma.ozonDeliveryJob.count(), 0);
  config.enabled = false; await save();
  const disabledCheckout = await (await request("/checkout/")).text();
  assert(disabledCheckout.includes("Ozon Доставка</strong>"));
  assert(!disabledCheckout.includes('value="ozon-delivery"'));
  assert(disabledCheckout.includes('aria-disabled="true"'));
  const manualOrder = actionForm(disabledCheckout, 'name="expectedTotal"');
  for (const [key, value] of Object.entries({ name: "QA Recipient Test", phone: "+79991234567", email: "buyer@example.test", delivery: "pickup", city: "", address: "", postalCode: "", comment: "QA order only", payment: "manual", legal: "on", expectedTotal: "240" })) manualOrder.set(key, value);
  const orderResult = await request("/checkout/", manualOrder);
  const number = (orderResult.headers.get("location") || "").match(/\/checkout\/success\/([^/]+)\//)?.[1];
  assert(number, "QA manual order should complete");
  const createdOrder = await prisma.order.findUniqueOrThrow({ where: { number } }); fixtureOrderId = createdOrder.id;
  assert.equal(createdOrder.userId, user.id); assert.equal(createdOrder.customerPhone, "+79991234567"); assert.equal(Number(createdOrder.total), 240);
  assert(await prisma.auditLog.findFirst({ where: { entityId: createdOrder.id, action: "order.offer.accept" } }));
  assert(![...jar.keys()].some(key => key.startsWith("3dp_order_")), "Signed-in orders must not receive guest access cookies");
  // Restore only the QA cart row consumed by this isolated test.
  await prisma.cartItem.create({ data: { cartId: cart.id, productId: product.id, quantity: 1, unitPrice: 240, config: {} } });
  await prisma.siteSetting.update({ where: { key: "legal.seller" }, data: { value: "" } });
  assert((await (await request("/checkout/")).text()).includes("продавец должен заполнить сведения оператора"));
  assert((await (await request("/register/")).text()).includes("Регистрация временно недоступна"));
  await prisma.siteSetting.update({ where: { key: "legal.seller" }, data: { value: "QA operator (test only)" } });
  const dashboard = await prisma.permission.findUniqueOrThrow({ where: { code: "dashboard.view" } });
  fixtureRole = (await prisma.role.create({ data: { code: "qa-privacy-" + randomUUID(), name: "QA restricted viewer", permissions: { create: { permissionId: dashboard.id } } } })).id;
  await prisma.userRole.deleteMany({ where: { userId: user.id } }); await prisma.userRole.create({ data: { userId: user.id, roleId: fixtureRole } });
  for (const protectedPage of ["/admin/orders/", "/admin/users/", "/admin/audit/", "/admin/settings/", "/admin/privacy/"]) assert.match((await request(protectedPage)).headers.get("location") || "", /forbidden/, protectedPage);
  console.log("PASS: Ozon Delivery settings, secret redaction/preservation, admin and anonymous permissions, CSRF, scoped PVZ search, packaging fields, enabled/disabled checkout and refusal of unquoted delivery. No Ozon API calls or real orders/payments.");
  console.log("PASS: separate registration/profile consent, missing-operator gate, private export, own data requests, per-section personal-data access controls.");
  console.log("PASS: isolated QA manual order with accepted-offer evidence; no guest access grant for signed-in buyer.");
} finally {
  if (fixtureOrderId) { await prisma.order.deleteMany({ where: { id: fixtureOrderId } }); await prisma.auditLog.deleteMany({ where: { entityId: fixtureOrderId, action: "order.offer.accept" } }); }
  if (qaUserId && fixtureRole) { await prisma.userRole.deleteMany({ where: { userId: qaUserId } }); await prisma.userRole.createMany({ data: originalRoles.map(roleId => ({ userId: qaUserId!, roleId })) }); }
  if (fixtureRole) await prisma.role.delete({ where: { id: fixtureRole } });
  await prisma.privacyRequest.deleteMany({ where: { id: { in: privacyRequests } } });
  for (const key of operatorKeys) {
    const previous = oldOperator.find(row => row.key === key);
    if (previous) await prisma.siteSetting.update({ where: { key }, data: { value: previous.value === null ? Prisma.JsonNull : previous.value as Prisma.InputJsonValue } });
    else await prisma.siteSetting.deleteMany({ where: { key } });
  }
  if (cartId) await prisma.cart.deleteMany({ where: { id: cartId } });
  if (productId) await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.ozonDeliveryPoint.deleteMany({ where: { id: pointId, generation: "qa-only" } });
  if (old) await prisma.siteSetting.upsert({ where: { key: OZON_DELIVERY_SETTING }, create: { ...old, value: old.value === null ? Prisma.JsonNull : old.value as Prisma.InputJsonValue }, update: { value: old.value === null ? Prisma.JsonNull : old.value as Prisma.InputJsonValue } });
  else await prisma.siteSetting.deleteMany({ where: { key: OZON_DELIVERY_SETTING } });
  await prisma.$disconnect();
}
