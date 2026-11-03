// Isolated database and synthetic carrier API only; never touches real orders.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { encryptSecret } from "../src/lib/integration-secrets";
import { CDEK_SETTING } from "../src/lib/delivery/cdek-config";
import { processCdekJob } from "../src/lib/delivery/cdek-worker";

const db = new URL(process.env.DATABASE_URL || "");
assert(["localhost", "127.0.0.1"].includes(db.hostname) && db.pathname === "/shop_qa");
const prefix = `qa-cdek-${randomUUID()}`, originalFetch = globalThis.fetch;
const keys = [CDEK_SETTING, "legal.seller", "legal.address", "contacts.email"];
const oldSettings = await prisma.siteSetting.findMany({ where: { key: { in: keys } } });
const orderIds: string[] = [];
let creates = 0, deletes = 0, loseCreate = false, started: (() => void) | undefined, release: Promise<void> | undefined;
let deleted = false;
let remoteId = randomUUID();
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  assert.equal(url.hostname, "api.edu.cdek.ru");
  if (url.pathname === "/v2/oauth/token") return Response.json({ access_token: "test" });
  if (url.pathname === "/v2/orders" && init?.method === "POST") {
    creates++;
    remoteId = randomUUID();
    if (started) { started(); await release; }
    if (loseCreate) { loseCreate = false; throw new Error("lost synthetic response"); }
    return Response.json({ entity: { uuid: remoteId }, requests: [{ type: "CREATE", state: "ACCEPTED" }] }, { status: 202 });
  }
  if (url.pathname === `/v2/orders/${remoteId}` && init?.method === "DELETE") { deletes++; deleted = true; return Response.json({ requests: [{ type: "DELETE", state: "ACCEPTED" }] }, { status: 202 }); }
  if (url.pathname === `/v2/orders/${remoteId}` && init?.method === "GET") {
    if (deleted) return Response.json({ requests: [{ errors: [{ code: "v2_entity_not_found" }] }] }, { status: 400 });
    return Response.json({ entity: { uuid: remoteId, cdek_number: 123456, statuses: [{ code: "CREATED" }] }, requests: [{ type: "CREATE", state: "SUCCESSFUL" }] });
  }
  throw new Error("unexpected synthetic endpoint");
};
async function makeOrder() {
  const order = await prisma.order.create({ data: { number: `${prefix}-${orderIds.length}`, kind: "APPLICATION", status: "NEW", customerName: "QA", customerEmail: "qa@example.test", customerPhone: "+79990000000", subtotal: 240, deliveryPrice: 264, total: 504, shipment: { create: { provider: "cdek-delivery", method: "CDEK QA", cost: 264, cdekJob: { create: { clientId: prefix, environment: "test", request: { type: 2 } } } } } }, include: { shipment: { include: { cdekJob: true } } } });
  orderIds.push(order.id); return { order, job: order.shipment!.cdekJob! };
}
async function due(id: string) { await prisma.cdekDeliveryJob.update({ where: { id }, data: { nextAttemptAt: new Date(0) } }); }
try {
  for (const [key, value] of Object.entries({ "legal.seller": "QA operator", "legal.address": "QA address", "contacts.email": "qa@example.test" })) await prisma.siteSetting.upsert({ where: { key }, create: { key, value, group: "legal" }, update: { value } });
  const value = { enabled: false, clientId: prefix, clientSecret: encryptSecret("test", CDEK_SETTING), environment: "test", senderCityCode: 44, senderPoint: "MOS4", senderName: "QA", senderPhone: "+79990000000" };
  await prisma.siteSetting.upsert({ where: { key: CDEK_SETTING }, create: { key: CDEK_SETTING, value, group: "integrations" }, update: { value } });
  const first = await makeOrder();
  assert(await processCdekJob()); assert.equal((await prisma.cdekDeliveryJob.findUniqueOrThrow({ where: { id: first.job.id } })).status, "ACCEPTED");
  await due(first.job.id); await processCdekJob(); assert.equal((await prisma.cdekDeliveryJob.findUniqueOrThrow({ where: { id: first.job.id } })).status, "CREATED");
  await prisma.$transaction([prisma.order.update({ where: { id: first.order.id }, data: { deletedAt: new Date() } }), prisma.cdekDeliveryJob.update({ where: { id: first.job.id }, data: { cancelRequestedAt: new Date(), nextAttemptAt: new Date(0) } })]);
  await processCdekJob(); assert.equal((await prisma.cdekDeliveryJob.findUniqueOrThrow({ where: { id: first.job.id } })).status, "CANCELING");
  await due(first.job.id); await processCdekJob(); assert.equal((await prisma.cdekDeliveryJob.findUniqueOrThrow({ where: { id: first.job.id } })).status, "CANCELED");
  const unsent = await makeOrder(); await prisma.cdekDeliveryJob.update({ where: { id: unsent.job.id }, data: { cancelRequestedAt: new Date() } }); await processCdekJob(); assert.equal((await prisma.cdekDeliveryJob.findUniqueOrThrow({ where: { id: unsent.job.id } })).status, "CANCELED");
  const lost = await makeOrder(); loseCreate = true; await processCdekJob(); assert.equal((await prisma.cdekDeliveryJob.findUniqueOrThrow({ where: { id: lost.job.id } })).status, "REVIEW"); assert.equal(await processCdekJob(), false); assert.equal(creates, 2);
  const race = await makeOrder(); deleted = false; let unblock!: () => void; release = new Promise(resolve => { unblock = resolve; }); const ready = new Promise<void>(resolve => { started = resolve; });
  const running = processCdekJob(); await ready; await prisma.$transaction([prisma.order.update({ where: { id: race.order.id }, data: { deletedAt: new Date() } }), prisma.cdekDeliveryJob.update({ where: { id: race.job.id }, data: { cancelRequestedAt: new Date(), nextAttemptAt: new Date(0) } })]); unblock(); await running; started = undefined;
  await due(race.job.id); await processCdekJob(); await due(race.job.id); await processCdekJob(); assert.equal((await prisma.cdekDeliveryJob.findUniqueOrThrow({ where: { id: race.job.id } })).status, "CANCELED"); assert.equal(deletes, 2);
  console.log("PASS CDEK: real database outbox, asynchronous creation and cancellation, uncertain response and concurrent deletion; synthetic carrier only.");
} finally {
  globalThis.fetch = originalFetch;
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  for (const key of keys) { const old = oldSettings.find(row => row.key === key); if (old) await prisma.siteSetting.update({ where: { key }, data: { value: old.value === null ? Prisma.JsonNull : old.value as Prisma.InputJsonValue } }); else await prisma.siteSetting.deleteMany({ where: { key } }); }
  await prisma.$disconnect();
}
