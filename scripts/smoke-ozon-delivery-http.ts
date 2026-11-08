import assert from "node:assert/strict";
import { assertInlineCheckoutError } from "./assert-inline-checkout-error";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
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
function actionForm(html: string, containing: string, alsoContaining?: string) {
  const markup = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(m => m[0]).find(text => text.includes(containing) && (!alsoContaining || text.includes(alsoContaining)));
  assert(markup, `Missing form ${containing}`);
  const body = new FormData();
  for (const match of markup.matchAll(/<input\b[^>]*>/g)) {
    const name = match[0].match(/name="([^"]*)"/)?.[1], value = match[0].match(/value="([^"]*)"/)?.[1] || "";
    if (name && (name.startsWith("$ACTION") || match[0].includes('type="hidden"'))) body.set(name.replace(/&amp;/g, "&"), value.replace(/&amp;/g, "&").replace(/&quot;/g, '"'));
  }
  return body;
}
const path = "/account/integrations/", secret = "fixture-delivery-secret-never-public";
const old = await prisma.siteSetting.findUnique({ where: { key: OZON_DELIVERY_SETTING } });
const operatorKeys = ["legal.seller", "legal.address", "contacts.email"];
const oldOperator = await prisma.siteSetting.findMany({ where: { key: { in: operatorKeys } } });
const oldDeliveryAuditIds = (await prisma.auditLog.findMany({ where: { entityType: "DeliveryMethod" }, select: { id: true } })).map(row => row.id);
const pointId = "9100000001";
const extraPointIds = ["9100000002", "9100000003", "9100000004", "9100000005", "9100000006"];
const paginationGeneration = `qa-pagination-${randomUUID()}`;
const paginationCity = `Тестоград-${randomUUID().slice(0, 8)}`;
const paginationIdBase = 1000000000000 + Number.parseInt(randomUUID().slice(0, 8), 16) * 1000;
const paginationPoints = Array.from({ length: 230 }, (_, index) => ({
  id: String(paginationIdBase + index), name: "QA ПВЗ пагинации", address: `Россия, ${paginationCity}, улица Тестовая, ${index + 1}`,
  type: "pvz", latitude: 55.75 + index / 100000, longitude: 37.62, active: true,
  clientId: "fixture-delivery-app", methodId: 7n, generation: paginationGeneration,
}));
let productId: string | undefined, cartId: string | undefined;
let fixtureOrderId: string | undefined;
let deletedCarrier: { id: string; active: boolean; deletedAt: Date | null } | undefined;
let customDeliveryId: string | undefined;
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
  for (const authenticated of [false, true]) {
    const exported = await request("/api/account/personal-data/", undefined, authenticated);
    assert.equal(exported.status, 410); assert.equal(await exported.text(), "");
    assert.match(exported.headers.get("cache-control") || "", /no-store/);
  }
  const registration = actionForm(await (await request("/register/")).text(), 'name="password"');
  registration.set("name", "QA"); registration.set("email", "no-consent@example.test"); registration.set("password", "LocalGalleryQA-2026");
  assert.equal((await request("/register/", registration, false)).headers.get("location"), "/register/?error=consent");
  assert.equal(await prisma.user.count({ where: { email: "no-consent@example.test" } }), 0);
  const profile = actionForm(await (await request("/account/profile/")).text(), 'name="company"');
  profile.set("name", "Should not save"); profile.set("phone", ""); profile.set("company", ""); profile.set("taxId", "");
  assert.equal((await request("/account/profile/", profile)).headers.get("location"), "/account/profile/?error=consent");
  assert.equal((await request("/account/privacy/")).headers.get("location"), "/contacts/");
  // Synthetic historical record preserves archive access-control coverage.
  const requestOwner = await prisma.user.findUniqueOrThrow({ where: { email: "qa@example.test" } });
  const ownRequest = await prisma.privacyRequest.create({ data: { userId: requestOwner.id, type: "ACCESS", message: "QA historical request: give processing information" } });
  privacyRequests.push(ownRequest.id);
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
  await prisma.ozonDeliveryPoint.create({ data: { id: pointId, name: "QA ПВЗ", address: "Москва, QA улица, 1", type: "pvz", latitude: 55.75, longitude: 37.62, active: true, clientId: config.clientId, methodId: 7n, generation: "qa-only" } });
  await prisma.ozonDeliveryPoint.createMany({ data: [
    { id: extraPointIds[0], name: "QA ПВЗ", address: "Россия, Орёл, улица Берёзовая, 20/2", type: "pvz", active: true, clientId: config.clientId, methodId: 7n, generation: "qa-only" },
    { id: extraPointIds[1], name: "QA другой магазин", address: "Москва, QA улица, 1", type: "pvz", active: true, clientId: "different-fixture-client", methodId: 7n, generation: "qa-only" },
    { id: extraPointIds[2], name: "QA ПВЗ", address: "Россия, Томск, улица Гагарина, 2", type: "pvz", active: true, clientId: config.clientId, methodId: 7n, generation: "qa-only" },
    { id: extraPointIds[3], name: "QA ПВЗ", address: "Россия, Омск, улица Бульварная, 20", type: "pvz", active: true, clientId: config.clientId, methodId: 7n, generation: "qa-only" },
    { id: extraPointIds[4], name: "QA ПВЗ", address: "Россия, Адыгея Республика, Тахтамукайский Район, Яблоновский, улица Гагарина, 190/2", type: "pvz", active: true, clientId: config.clientId, methodId: 7n, generation: "qa-only" },
  ] });
  const points = await request("/api/delivery/ozon/points/?q=Москва", undefined, false);
  assert.match(points.headers.get("cache-control") || "", /no-store/);
  const pointResult = await points.json();
  assert.match(pointResult.scope, /^[a-f0-9]{64}$/, "The directory response must include its delivery configuration fingerprint");
  assert.deepEqual(pointResult, { points: [{ id: pointId, name: "QA ПВЗ", address: "Москва, QA улица, 1", type: "pvz", latitude: 55.75, longitude: 37.62 }], truncated: false, nextOffset: null, scope: pointResult.scope });
  // Two public HTTP requests cross the former 200-point limit without touching Ozon.
  await prisma.ozonDeliveryPoint.createMany({ data: paginationPoints });
  const receivedPoints: { id: string; address: string }[] = [];
  let nextOffset: number | null = 0;
  for (const [pageIndex, expectedSize] of [200, 30].entries()) {
    assert.notEqual(nextOffset, null, "The first page must advertise its continuation");
    const response = await request(`/api/delivery/ozon/points/?q=${encodeURIComponent(paginationCity)}&offset=${nextOffset}`, undefined, false);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") || "", /no-store/);
    const page = await response.json();
    assert.equal(page.scope, pointResult.scope, "All pages must belong to the same delivery configuration");
    assert.equal(page.points.length, expectedSize);
    assert.equal(page.truncated, pageIndex === 0);
    assert.equal(page.nextOffset, pageIndex === 0 ? 200 : null);
    receivedPoints.push(...page.points);
    nextOffset = page.nextOffset;
  }
  assert.equal(nextOffset, null, "The final page must end pagination");
  assert.equal(receivedPoints.length, paginationPoints.length);
  assert.equal(new Set(receivedPoints.map(point => point.id)).size, paginationPoints.length, "Pagination must not repeat point IDs");
  assert.equal(new Set(receivedPoints.map(point => point.address)).size, paginationPoints.length, "Every fixture address must appear once");
  assert.deepEqual(new Map(receivedPoints.map(point => [point.id, point.address])), new Map(paginationPoints.map(point => [point.id, point.address])), "Real HTTP pagination must return every fixture point with its correct address");
  for (const query of ["Мос qa", "QA, Москва 1", "Москва _QA% 1"]) {
    const found = await (await request(`/api/delivery/ozon/points/?q=${encodeURIComponent(query)}`, undefined, false)).json();
    assert.deepEqual(found.points.map((point: { id: string }) => point.id), [pointId], "Partial words, separators and order must not hide the matched PVZ or expose another client");
  }
  const suggestions = await (await request(`/api/delivery/ozon/points/?q=${encodeURIComponent("берез орел 20/2")}&view=suggest`, undefined, false)).json();
  assert.deepEqual(suggestions.points.map((point: { id: string }) => point.id), [extraPointIds[0]], "ё must match е in actual PostgreSQL searches");
  assert.equal(suggestions.points[0].latitude, null, "Suggestions must not call provider for coordinate hydration");
  for (const query of ["Яблоновский Гагарина", "гагар яблон", "ЯБЛОНОВСКИЙ, гагарина 190/2"]) {
    const result = await (await request(`/api/delivery/ozon/points/?q=${encodeURIComponent(query)}&view=suggest`, undefined, false)).json();
    assert.deepEqual(result.points.map((point: { id: string }) => point.id), [extraPointIds[4]], "Real address structure must match separate city and street words");
  }
  const omsk = await (await request(`/api/delivery/ozon/points/?q=${encodeURIComponent("Омск")}&view=suggest`, undefined, false)).json();
  assert.deepEqual(omsk.points.map((point: { id: string }) => point.id), [extraPointIds[3]], "Омск must not match Томск");
  const wrongHouse = await (await request(`/api/delivery/ozon/points/?q=${encodeURIComponent("Яблоновский 19")}&view=suggest`, undefined, false)).json();
  assert.deepEqual(wrongHouse.points, [], "House 19 must not match 190");
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
  await assertInlineCheckoutError(await request("/checkout/", order), "invalid");
  assert.equal(await prisma.order.count(), ordersBefore); assert.equal(await prisma.ozonDeliveryJob.count(), 0);
  config.enabled = false; await save();
  const disabledCheckout = await (await request("/checkout/")).text();
  assert(!disabledCheckout.includes("Ozon Доставка</strong>"));
  assert(!disabledCheckout.includes('value="ozon-delivery"'));
  assert(!disabledCheckout.includes('value="cdek"'), "Legacy free CDEK must not bypass carrier pricing");
  const legacyOrder = actionForm(disabledCheckout, 'name="expectedTotal"');
  for (const [key, value] of Object.entries({ name: "QA Recipient Test", phone: "+79991234567", email: "buyer@example.test", delivery: "cdek", city: "Москва", address: "QA улица, 1", legal: "on", expectedTotal: "240" })) legacyOrder.set(key, value);
  await assertInlineCheckoutError(await request("/checkout/", legacyOrder), "delivery");
  const manualOrder = actionForm(disabledCheckout, 'name="expectedTotal"');
  const carrier = await prisma.deliveryMethod.findUniqueOrThrow({ where: { code: "russian-post" } });
  assert(Number(carrier.basePrice) > 0, "QA carrier fixture must have nonzero internal expenses");
  for (const [key, value] of Object.entries({ name: "QA Recipient Test", phone: "+79991234567", email: "buyer@example.test", delivery: "russian-post", city: "Москва", address: "QA улица, 1", postalCode: "123456", comment: "QA order only", payment: "manual", legal: "on", expectedTotal: "240" })) manualOrder.set(key, value);
  const orderResult = await request("/checkout/", manualOrder);
  const number = (orderResult.headers.get("location") || "").match(/\/checkout\/success\/([^/]+)\//)?.[1];
  assert(number, "QA manual order should complete");
  const createdOrder = await prisma.order.findUniqueOrThrow({ where: { number } }); fixtureOrderId = createdOrder.id;
  assert.equal(createdOrder.userId, user.id); assert.equal(createdOrder.customerPhone, "+79991234567"); assert.equal(Number(createdOrder.total), 240);
  assert.equal(Number(createdOrder.deliveryPrice), 0);
  assert.equal(Number((await prisma.shipment.findUniqueOrThrow({ where: { orderId: createdOrder.id } })).cost), Number(carrier.basePrice));
  assert.equal(createdOrder.kind, "APPLICATION"); assert.equal(createdOrder.status, "NEW");
  assert.equal(await prisma.payment.count({ where: { orderId: createdOrder.id } }), 0);
  assert.equal(await prisma.fiscalReceipt.count({ where: { orderId: createdOrder.id } }), 0);
  assert(await prisma.auditLog.findFirst({ where: { entityId: createdOrder.id, action: "order.application.create" } }));
  assert(![...jar.keys()].some(key => key.startsWith("3dp_order_")), "Signed-in orders must not receive guest access cookies");
  // Restore only the QA cart row consumed by this isolated test.
  await prisma.cartItem.create({ data: { cartId: cart.id, productId: product.id, quantity: 1, unitPrice: 240, config: {} } });
  const integrationsHtml = await (await request(path)).text();
  const newDelivery = actionForm(integrationsHtml, "Добавить доставку");
  const deliveryName = `QA delivery ${randomUUID()}`;
  for (const [key, value] of Object.entries({ name: deliveryName, description: "QA only", basePrice: "125.50", sortOrder: "9", active: "on" })) newDelivery.set(key, value);
  assert.equal((await request(path, newDelivery)).headers.get("location"), path + "?result=saved");
  const custom = await prisma.deliveryMethod.findFirstOrThrow({ where: { name: deliveryName } }); customDeliveryId = custom.id;
  assert.equal(Number(custom.basePrice), 125.5); assert.equal(custom.deletedAt, null);
  const customDelete = actionForm(await (await request(path)).text(), 'name="confirmation"', `value="${custom.id}"`);
  customDelete.set("confirmation", custom.id);
  assert.match((await request(path, customDelete, false)).headers.get("location") || "", /^\/login/);
  assert.equal((await prisma.deliveryMethod.findUniqueOrThrow({ where: { id: custom.id } })).deletedAt, null);
  assert.equal((await request(path, customDelete)).headers.get("location"), path + "?result=delivery-deleted");
  assert((await prisma.deliveryMethod.findUniqueOrThrow({ where: { id: custom.id } })).deletedAt);
  const removal = actionForm(integrationsHtml, 'name="confirmation"', `value="${carrier.id}"`);
  const staleEdit = actionForm(integrationsHtml, `name="id" value="${carrier.id}"`);
  assert.equal((await request(path, removal)).headers.get("location"), path + "?result=delivery-confirmation");
  removal.set("confirmation", "wrong-method");
  assert.equal((await request(path, removal)).headers.get("location"), path + "?result=delivery-confirmation");
  assert.equal((await prisma.deliveryMethod.findUniqueOrThrow({ where: { id: carrier.id } })).deletedAt, null);
  deletedCarrier = { id: carrier.id, active: carrier.active, deletedAt: carrier.deletedAt };
  removal.set("confirmation", carrier.id);
  assert.equal((await request(path, removal)).headers.get("location"), path + "?result=delivery-deleted");
  const removed = await prisma.deliveryMethod.findUniqueOrThrow({ where: { id: carrier.id } });
  assert.equal(removed.active, false); assert(removed.deletedAt);
  assert(await prisma.auditLog.findFirst({ where: { action: "integration.delivery.delete", entityId: carrier.id } }));
  assert(!(await (await request(path)).text()).includes(carrier.id));
  assert(!(await (await request("/delivery/")).text()).includes(carrier.name));
  await assertInlineCheckoutError(await request("/checkout/", manualOrder), "delivery");
  for (const [key, value] of Object.entries({ name: carrier.name, description: carrier.description || "", basePrice: String(carrier.basePrice), sortOrder: String(carrier.sortOrder), active: "on" })) staleEdit.set(key, value);
  assert.equal((await request(path, staleEdit)).headers.get("location"), path + "?result=delivery-missing");
  assert.equal((await request(path, removal)).headers.get("location"), path + "?result=delivery-missing");
  execFileSync("pnpm", ["db:seed"], { env: { ...process.env, BOOTSTRAP_ADMIN_EMAIL: "qa@example.test", BOOTSTRAP_ADMIN_PASSWORD: "LocalGalleryQA-2026" }, stdio: "pipe" });
  const afterSeed = await prisma.deliveryMethod.findUniqueOrThrow({ where: { id: carrier.id } });
  assert.equal(afterSeed.active, false); assert(afterSeed.deletedAt, "Deployment seed must not revive removed defaults");
  const oldShipment = await prisma.shipment.findUniqueOrThrow({ where: { orderId: createdOrder.id } });
  assert.equal(oldShipment.provider, carrier.code); assert.equal(oldShipment.method, carrier.name); assert.equal(Number(oldShipment.cost), Number(carrier.basePrice));
  assert.equal(await prisma.order.count(), ordersBefore + 1);
  await prisma.siteSetting.update({ where: { key: "legal.seller" }, data: { value: "" } });
  assert((await (await request("/checkout/")).text()).includes("продавец должен заполнить сведения оператора"));
  assert((await (await request("/register/")).text()).includes("Регистрация временно недоступна"));
  await prisma.siteSetting.update({ where: { key: "legal.seller" }, data: { value: "QA operator (test only)" } });
  const dashboard = await prisma.permission.findUniqueOrThrow({ where: { code: "dashboard.view" } });
  fixtureRole = (await prisma.role.create({ data: { code: "qa-privacy-" + randomUUID(), name: "QA restricted viewer", permissions: { create: { permissionId: dashboard.id } } } })).id;
  await prisma.userRole.deleteMany({ where: { userId: user.id } }); await prisma.userRole.create({ data: { userId: user.id, roleId: fixtureRole } });
  for (const protectedPage of ["/admin/orders/", "/admin/users/", "/admin/audit/", "/admin/settings/", "/admin/privacy/"]) assert.match((await request(protectedPage)).headers.get("location") || "", /forbidden/, protectedPage);
  console.log("PASS: Ozon Delivery settings, secret redaction/preservation, admin and anonymous permissions, CSRF, scoped PVZ search, packaging fields, enabled/disabled checkout and refusal of unquoted delivery. No Ozon API calls or real orders/payments.");
  console.log("PASS: separate registration/profile consent, missing-operator gate, retired export/portal, protected historical requests, per-section personal-data access controls.");
  console.log("PASS: isolated QA application without payment / fiscal receipt and with accepted-terms evidence; no guest access grant for signed-in buyer.");
  console.log("PASS: delivery creation/deletion with confirmation, anonymous denial, stale edits/orders rejected, historical shipments unchanged and deployment seed does not revive deleted methods.");
  console.log("PASS: public PVZ word search, partial and reordered terms, ё/е normalization and scoped suggestions without provider calls while typing.");
  console.log("PASS: public HTTP PVZ pagination returns all 230 city points across two pages, with stable scope and no missing or duplicate IDs/addresses.");
} finally {
  if (deletedCarrier) await prisma.deliveryMethod.update({ where: { id: deletedCarrier.id }, data: { active: deletedCarrier.active, deletedAt: deletedCarrier.deletedAt } });
  if (customDeliveryId) await prisma.deliveryMethod.deleteMany({ where: { id: customDeliveryId } });
  await prisma.auditLog.deleteMany({ where: { id: { notIn: oldDeliveryAuditIds }, entityType: "DeliveryMethod", entityId: { in: [deletedCarrier?.id, customDeliveryId].filter((id): id is string => !!id) } } });
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
  await prisma.ozonDeliveryPoint.deleteMany({ where: { id: { in: [pointId, ...extraPointIds] }, generation: "qa-only" } });
  await prisma.ozonDeliveryPoint.deleteMany({ where: { id: { in: paginationPoints.map(point => point.id) }, generation: paginationGeneration } });
  if (old) await prisma.siteSetting.upsert({ where: { key: OZON_DELIVERY_SETTING }, create: { ...old, value: old.value === null ? Prisma.JsonNull : old.value as Prisma.InputJsonValue }, update: { value: old.value === null ? Prisma.JsonNull : old.value as Prisma.InputJsonValue } });
  else await prisma.siteSetting.deleteMany({ where: { key: OZON_DELIVERY_SETTING } });
  await prisma.$disconnect();
}
