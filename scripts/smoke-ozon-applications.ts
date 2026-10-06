// Real database lifecycle with synthetic carrier responses. No external calls.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { encryptSecret } from "../src/lib/integration-secrets";
import { OZON_DELIVERY_SETTING } from "../src/lib/delivery/ozon-config";
import { cancelOzonJob, processOzonJob } from "../src/lib/delivery/ozon-worker";
import { queueExistingOzonApplication } from "../src/lib/delivery/ozon-applications";
import { CONSENT_VERSION } from "../src/lib/privacy-documents";

const db = new URL(process.env.DATABASE_URL || "");
assert(["localhost", "127.0.0.1"].includes(db.hostname) && db.pathname === "/shop_qa");
const originalFetch = globalThis.fetch, prefix = `qa-ozon-app-${randomUUID()}`;
const keys = [OZON_DELIVERY_SETTING, "legal.seller", "legal.address", "contacts.email"];
const oldSettings = await prisma.siteSetting.findMany({ where: { key: { in: keys } } });
const orders: string[] = [], consents: string[] = [], jobs: string[] = [];
let productId = "", remoteCreates = 0, remoteCancels = 0;
const remotes = new Map<string, { order_number: string; postings: { request_id: number; posting_number: string }[] }>();
const statuses = new Map<string, string>();
let failCancel = false, loseCreateResponse = false;
let createStarted: (() => void) | undefined, createRelease: Promise<void> | undefined;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  assert(["xapi.ozon.ru", "api-delivery.ozon.ru"].includes(url.hostname), "Unexpected outbound request denied");
  const body = JSON.parse(String(init?.body ?? "{}"));
  const result = (value: unknown) => Response.json(value);
  if (url.pathname === "/oauth/token") return result({ access_token: "qa-only" });
  if (url.pathname === "/v1/delivery/check-client") return result({ can_be_delivered: true });
  if (url.pathname === "/v1/order/checkout") return result({ results: body.postings.map((posting: { request_id: number }) => ({ request_id: posting.request_id, posting: { estimated_delivery_cost: { amount: "100.00", currency_code: "RUB" }, estimated_insurance_cost: { amount: "1.00", currency_code: "RUB" }, estimated_delivery_days: 2, cutoff_at: "2030-01-01T12:00:00Z" } })) });
  if (url.pathname === "/v1/order/create") {
    const key = new Headers(init?.headers).get("Idempotency-Key"); assert(key);
    if (!remotes.has(key)) {
      remoteCreates++;
      const postings = body.postings.map((posting: { request_id: number }, index: number) => ({ request_id: posting.request_id, posting_number: `${prefix}-${remoteCreates}-${index}` }));
      remotes.set(key, { order_number: `${prefix}-${remoteCreates}`, postings });
      for (const posting of postings) statuses.set(posting.posting_number, "created");
    }
    if (createStarted) { createStarted(); await createRelease; }
    if (loseCreateResponse) { loseCreateResponse = false; throw new Error("synthetic lost response after remote success"); }
    return result(remotes.get(key));
  }
  if (url.pathname === "/v1/posting/info") return result({ postings: body.posting_numbers.map((posting_number: string) => ({ posting_number, status: statuses.get(posting_number), status_changed_at: "2030-01-01T12:00:00Z" })) });
  if (url.pathname === "/v1/posting/cancel") { if (failCancel) { failCancel = false; throw new Error("synthetic cancel transport failure"); } remoteCancels++; statuses.set(body.posting_number, "canceled"); return new Response(null, { status: 204 }); }
  throw new Error("Unexpected fixture endpoint");
};
async function application(withJob = true) {
  const order = await prisma.order.create({ data: { number: `${prefix}-${orders.length}`, kind: "APPLICATION", status: "NEW", customerName: "Synthetic buyer", customerEmail: "qa@example.test", customerPhone: "+79991234567", subtotal: 240, total: 240, items: { create: { productId, productName: "QA Product", quantity: 2, unitPrice: 120, totalPrice: 240 } }, shipment: { create: { provider: "ozon-delivery", method: "QA", cost: 202, payload: { pointId: 42 } } } }, include: { shipment: true } });
  orders.push(order.id);
  const consent = await prisma.privacyConsent.create({ data: { orderId: order.id, purpose: "ozon", version: CONSENT_VERSION, subjectHash: prefix, document: { synthetic: true }, expiresAt: new Date(Date.now() - 3600000) } }); consents.push(consent.id);
  if (withJob) { const id = await queueExistingOzonApplication(order.id); jobs.push(id); return { order, id }; }
  return { order, id: "" };
}
async function archive(orderId: string, id: string) {
  await prisma.$transaction(async tx => {
    await tx.order.update({ where: { id: orderId }, data: { deletedAt: new Date() } });
    await tx.ozonDeliveryJob.update({ where: { id }, data: { cancelRequestedAt: new Date(), nextAttemptAt: new Date() } });
  });
}
try {
  for (const [key, value] of Object.entries({ "legal.seller": "QA operator", "legal.address": "QA address", "contacts.email": "qa@example.test" })) await prisma.siteSetting.upsert({ where: { key }, create: { key, value, group: "legal" }, update: { value } });
  const config = { enabled: true, clientId: prefix, clientSecret: encryptSecret("qa-only", OZON_DELIVERY_SETTING), shipmentMethodId: 7, dispatchDays: 1, checkedAt: new Date().toISOString() };
  await prisma.siteSetting.upsert({ where: { key: OZON_DELIVERY_SETTING }, create: { key: OZON_DELIVERY_SETTING, value: config, group: "integrations" }, update: { value: config } });
  const product = await prisma.product.create({ data: { name: "QA Product", sku: prefix, slug: prefix, type: "READY", status: "PUBLISHED", basePrice: 120, shippingWeightG: 100, shippingLengthMm: 200, shippingWidthMm: 100, shippingHeightMm: 50 } }); productId = product.id;
  const first = await application();
  assert.equal(await queueExistingOzonApplication(first.order.id), first.id, "Repair cannot duplicate a job");
  assert(await processOzonJob(first.id)); assert.equal(remoteCreates, 1);
  assert.equal((await prisma.ozonDeliveryJob.findUniqueOrThrow({ where: { id: first.id } })).status, "CREATED");
  assert.equal(await prisma.payment.count({ where: { orderId: first.order.id } }), 0); assert.equal(await prisma.fiscalReceipt.count({ where: { orderId: first.order.id } }), 0);
  await archive(first.order.id, first.id); assert.equal(await processOzonJob(first.id), false);
  await assert.rejects(queueExistingOzonApplication(first.order.id), /ineligible/);
  failCancel = true; assert(await cancelOzonJob(first.id));
  assert.equal((await prisma.ozonDeliveryJob.findUniqueOrThrow({ where: { id: first.id } })).cancelError, "transport");
  assert(await cancelOzonJob(first.id)); assert.equal(remoteCancels, 2);
  assert.equal((await prisma.ozonDeliveryJob.findUniqueOrThrow({ where: { id: first.id } })).status, "CANCELED");
  assert.equal(await cancelOzonJob(first.id), false);
  const unsent = await application(); await archive(unsent.order.id, unsent.id); await cancelOzonJob(unsent.id); assert.equal(remoteCreates, 1);
  const ambiguous = await application(); loseCreateResponse = true; await processOzonJob(ambiguous.id); assert.equal(remoteCreates, 2);
  await archive(ambiguous.order.id, ambiguous.id); await cancelOzonJob(ambiguous.id); assert.equal(remoteCreates, 2, "Cancellation reused identity after lost response");
  assert.equal((await prisma.ozonDeliveryJob.findUniqueOrThrow({ where: { id: ambiguous.id } })).status, "CANCELED");
  const racing = await application(); let release!: () => void;
  createRelease = new Promise<void>(resolve => { release = resolve; }); const started = new Promise<void>(resolve => { createStarted = resolve; });
  const creating = processOzonJob(racing.id); await started; await archive(racing.order.id, racing.id);
  assert.equal(await cancelOzonJob(racing.id), false, "Cancellation waits for in-flight creator lease");
  release(); await creating; createStarted = undefined; await cancelOzonJob(racing.id);
  assert.equal((await prisma.ozonDeliveryJob.findUniqueOrThrow({ where: { id: racing.id } })).status, "CANCELED"); assert.equal(remoteCreates, 3);
  const revoked = await application(false); await prisma.privacyConsent.update({ where: { id: consents.at(-1)! }, data: { revokedAt: new Date() } });
  await assert.rejects(queueExistingOzonApplication(revoked.order.id), /consent/); assert.equal(await prisma.ozonDeliveryJob.count({ where: { shipment: { orderId: revoked.order.id } } }), 0);
  assert.equal(await prisma.payment.count({ where: { orderId: { in: orders } } }), 0);
  console.log("PASS Ozon applications: real DB outbox without payment, immutable/idempotent repair and creation, all-parcel cancellation, unsent cancellation, provider retry, lost response and in-flight deletion, revoked-consent denial. Synthetic API only.");
} finally {
  globalThis.fetch = originalFetch;
  await prisma.auditLog.deleteMany({ where: { entityId: { in: orders } } });
  await prisma.privacyConsent.deleteMany({ where: { id: { in: consents } } });
  await prisma.order.deleteMany({ where: { id: { in: orders } } });
  if (productId) await prisma.product.delete({ where: { id: productId } });
  for (const key of keys) { const old = oldSettings.find(row => row.key === key); if (old) await prisma.siteSetting.update({ where: { key }, data: { value: old.value === null ? Prisma.JsonNull : old.value as Prisma.InputJsonValue } }); else await prisma.siteSetting.deleteMany({ where: { key } }); }
  await prisma.$disconnect();
}
