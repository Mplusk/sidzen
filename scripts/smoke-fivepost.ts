import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { encryptSecret } from "../src/lib/integration-secrets";
import { FIVEPOST_SETTING, fivePostSchema, fivePostScope } from "../src/lib/delivery/fivepost-config";
import { fivePostDirectory, selectedFivePostPoint, syncFivePostPage } from "../src/lib/delivery/fivepost-directory";
import { processFivePostJob } from "../src/lib/delivery/fivepost-worker";
import { GET as pointsRequest } from "../src/app/api/delivery/fivepost/points/route";

const database = new URL(process.env.DATABASE_URL || "");
assert(["127.0.0.1", "localhost"].includes(database.hostname) && database.pathname === "/shop_qa");
const config = fivePostSchema.parse({ enabled: true, apiKey: randomUUID(), environment: "production", warehouseId: randomUUID(), senderLocation: "QA", rateType: "QA", baseKg: 1, checkedAt: new Date().toISOString() });
const settings = { ...config, apiKey: encryptSecret(config.apiKey, FIVEPOST_SETTING) };
assert.equal(await prisma.fivePostDirectory.count(), 0);
assert.equal(await prisma.siteSetting.count({ where: { key: { in: [FIVEPOST_SETTING, "integrations.fivepost-token.production"] } } }), 0);
const first = randomUUID(), second = randomUUID(), remoteId = randomUUID(), number = `QA-5P-${randomUUID()}`;
const originalFetch = globalThis.fetch;
let tokens = 0, creates = 0, deletes = 0, rejectPage = false;
const point = (id: string) => ({ id, name: "QA", type: "POSTAMAT", extStatus: "ACTIVE", fullAddress: "Москва, улица Тверская, 8", address: { city: "Москва", region: "Москва", lat: 55.75, lng: 37.6 }, cellLimits: { maxCellLength: 500, maxCellWidth: 400, maxCellHeight: 300, maxWeight: 15000000 }, rate: [{ rateType: "QA", zone: "1", rateCurrency: "RUB", rateValueWithVat: 120, rateExtraValueWithVat: 30 }] });
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  assert.equal(url.origin, "https://api-omni.x5.ru");
  if (url.pathname.startsWith("/jwt-generate-claims/")) {
    assert.equal(url.searchParams.get("apikey"), config.apiKey);
    assert.equal((init?.body as URLSearchParams).get("audience"), "A122019!");
    tokens++; return Response.json({ status: "ok", jwt: "test-only-token" });
  }
  assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-only-token");
  if (url.pathname === "/api/v1/pickuppoints/query") {
    const { pageNumber } = JSON.parse(String(init?.body));
    if (rejectPage) return new Response(null, { status: 429 });
    return Response.json({ totalPages: 2, content: [point(pageNumber === 0 ? first : second)] });
  }
  if (url.pathname === "/api/v3/orders") {
    const [order] = JSON.parse(String(init?.body)).partnerOrders;
    assert.equal(order.senderOrderId, number); assert.equal(order.cost.paymentValue, 0);
    assert.equal(order.cargoes[0].productValues[0].vat, -1);
    creates++; throw new Error("synthetic lost reply after registration");
  }
  if (url.pathname === "/api/v1/getOrderStatus") return Response.json([{ orderId: remoteId, senderOrderId: number, status: "APPROVED", executionStatus: "CREATED", changeDate: new Date().toISOString() }]);
  if (url.pathname === `/api/v2/cancelOrder/byOrderId/${remoteId}` && init?.method === "DELETE") { deletes++; return Response.json({ error: false }); }
  throw new Error("unexpected mock request");
};
const due = () => prisma.fivePostDirectory.update({ where: { id: "5post" }, data: { nextAttemptAt: new Date(0) } });
const operator = { "legal.seller": "QA operator", "legal.address": "QA address", "contacts.email": "qa@example.test" };
const previousOperator = await prisma.siteSetting.findMany({ where: { key: { in: Object.keys(operator) } } });
const previousStorage = process.env.PERSONAL_DATA_RF_STORAGE_CONFIRMED;
let orderId: string | undefined;
try {
  process.env.PERSONAL_DATA_RF_STORAGE_CONFIRMED = "true";
  for (const [key, value] of Object.entries(operator)) await prisma.siteSetting.upsert({ where: { key }, create: { key, group: "legal", value }, update: { value } });
  await prisma.siteSetting.create({ data: { key: FIVEPOST_SETTING, group: "integrations", value: settings } });
  await prisma.fivePostDirectory.create({ data: { id: "5post", scope: fivePostScope(config), staging: randomUUID() } });
  await Promise.all([syncFivePostPage(), syncFivePostPage()]);
  assert.equal((await fivePostDirectory()).generation, null);
  rejectPage = true; await due(); await syncFivePostPage();
  assert.equal((await fivePostDirectory()).generation, null);
  rejectPage = false; await due(); await syncFivePostPage();
  const published = (await fivePostDirectory()).generation;
  assert(published); assert.equal((await selectedFivePostPoint(second)).point.city, "Москва");
  const request = (query: string) => pointsRequest(new Request("http://localhost/api/delivery/fivepost/points/?" + query));
  const suggestions = await (await request("view=cities&q=мо")).json();
  assert.equal(suggestions.cities[0].city, "Москва");
  const map = await (await request("view=viewport&bbox=37.59,55.74,37.61,55.76&zoom=18")).json();
  assert.equal(map.scope, published); assert.equal(map.points.length, 2);
  const created = await prisma.order.create({ data: { number, status: "AWAITING_PAYMENT", customerName: "QA", customerEmail: "qa@example.test", customerPhone: "+79990000000", subtotal: 240, deliveryPrice: 0, total: 240,
    items: { create: { productName: "QA", sku: "qa", quantity: 1, unitPrice: 240, totalPrice: 240 } },
    payment: { create: { provider: "yookassa-online", status: "PENDING", amount: 240 } },
    shipment: { create: { provider: "fivepost-delivery", method: "5Post", cost: 120, payload: { pointId: first, parcel: { weight: 150000, height: 50, width: 100, length: 100 } }, fivePostJob: { create: { warehouseId: config.warehouseId, senderLocation: config.senderLocation } } } },
  }, include: { shipment: { include: { fivePostJob: true } } } });
  orderId = created.id;
  const job = created.shipment!.fivePostJob!;
  await processFivePostJob(); assert.equal(creates, 0);
  await prisma.siteSetting.update({ where: { key: FIVEPOST_SETTING }, data: { value: { ...settings, enabled: false } } });
  assert.equal((await request("view=cities&q=мо")).status, 409);
  await assert.rejects(() => selectedFivePostPoint(first));
  await prisma.payment.update({ where: { orderId }, data: { status: "PAID" } });
  await prisma.order.update({ where: { id: orderId }, data: { status: "PAID" } });
  await Promise.all([processFivePostJob(), processFivePostJob()]); assert.equal(creates, 1);
  await prisma.fivePostDeliveryJob.update({ where: { id: job.id }, data: { nextAttemptAt: new Date(0) } });
  await processFivePostJob(); assert.equal(creates, 1);
  assert.equal((await prisma.fivePostDeliveryJob.findUniqueOrThrow({ where: { id: job.id } })).remoteId, remoteId);
  assert.equal((await prisma.shipment.findUniqueOrThrow({ where: { orderId } })).tracking, number);
  await prisma.fivePostDeliveryJob.update({ where: { id: job.id }, data: { cancelRequestedAt: new Date(), nextAttemptAt: new Date(0) } });
  await processFivePostJob(); assert.equal(deletes, 1);
  assert.equal((await prisma.fivePostDeliveryJob.findUniqueOrThrow({ where: { id: job.id } })).status, "CANCELED");
  assert.equal(tokens, 1);
  console.log("PASS 5Post directory publication, checkout map, disable, prepaid dispatch, lost reply recovery and cancellation (synthetic carrier).");
} finally {
  globalThis.fetch = originalFetch;
  if (orderId) await prisma.order.delete({ where: { id: orderId } });
  await prisma.fivePostPoint.deleteMany({ where: { id: { in: [first, second] } } });
  await prisma.fivePostDirectory.deleteMany({ where: { id: "5post", scope: fivePostScope(config) } });
  await prisma.siteSetting.deleteMany({ where: { key: { in: [FIVEPOST_SETTING, "integrations.fivepost-token.production"] } } });
  for (const key of Object.keys(operator)) {
    const previous = previousOperator.find(row => row.key === key);
    if (previous) await prisma.siteSetting.update({ where: { key }, data: { value: previous.value === null ? Prisma.JsonNull : previous.value } });
    else await prisma.siteSetting.deleteMany({ where: { key } });
  }
  if (previousStorage === undefined) delete process.env.PERSONAL_DATA_RF_STORAGE_CONFIRMED;
  else process.env.PERSONAL_DATA_RF_STORAGE_CONFIRMED = previousStorage;
  await prisma.$disconnect();
}
