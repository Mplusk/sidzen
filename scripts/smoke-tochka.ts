// No real banking access. All mutations are confined to disposable shop_qa.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { encryptSecret } from "../src/lib/integration-secrets";
import { applyTochkaPayment, createOnlinePayment, reconcileTochkaPayments } from "../src/lib/payments";
import { TOCHKA_SETTING } from "../src/lib/tochka/config";
import type { TochkaOperation } from "../src/lib/tochka/client";

const database = new URL(process.env.DATABASE_URL || "");
assert(["127.0.0.1", "localhost"].includes(database.hostname) && database.pathname === "/shop_qa", "Disposable local shop_qa only");
assert(process.env.AUTH_SECRET && process.env.PERSONAL_DATA_RF_STORAGE_CONFIRMED === "true");
const prefix = `TOCHKAQA-${randomUUID().slice(0, 8)}`;
const oldConfig = await prisma.siteSetting.findUnique({ where: { key: TOCHKA_SETTING } });
const operatorKeys = ["legal.seller", "legal.address", "contacts.email"];
const oldOperator = await prisma.siteSetting.findMany({ where: { key: { in: operatorKeys } } });
const orderIds: string[] = [], paymentIds: string[] = [];
const bank = new Map<string, TochkaOperation>();
let posts = 0, loseNextResponse = false;
const originalFetch = globalThis.fetch;
const config = { enabled: true, token: encryptSecret("synthetic-qa-bank-token-no-real-access", TOCHKA_SETTING), customerCode: "1234567ab", merchantId: "200000000001097", card: true, sbp: true, receiptMode: "provider", vatType: "none", taxSystemCode: "usn_income", externalReceiptsConfirmed: false, checkedAt: new Date().toISOString() };
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  assert.equal(url.origin, "https://enter.tochka.com", "No unexpected network calls");
  assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer synthetic-qa-bank-token-no-real-access");
  if (init?.method === "POST") {
    assert.equal(url.pathname, "/uapi/acquiring/v1.0/payments_with_receipt");
    const body = JSON.parse(String(init.body)).Data;
    assert.equal(body.amount, 150); assert.equal(body.preAuthorization, false); assert.deepEqual(body.Client, { email: "fixture@example.test" });
    assert.equal(body.Items.length, 1); assert.equal(body.Items[0].amount, 50); assert.equal(body.Items[0].quantity, 3); assert.equal(body.Items[0].paymentObject, "goods");
    assert(![...bank.values()].some(item => item.paymentLinkId === body.paymentLinkId), "Must never create a duplicate link");
    posts++;
    const remote: TochkaOperation = { operationId: randomUUID(), amount: body.amount, status: "CREATED", customerCode: body.customerCode, merchantId: body.merchantId, paymentLinkId: body.paymentLinkId, paymentLink: "https://merch.tochka.com/order/qa-only" };
    bank.set(remote.operationId, remote);
    // Allow overlapping clicks while the first bank request is in flight.
    await new Promise(resolve => setTimeout(resolve, 30));
    if (loseNextResponse) { loseNextResponse = false; throw new Error("Synthetic lost response"); }
    return Response.json({ Data: remote });
  }
  assert.equal(init?.method, "GET");
  if (url.pathname === "/uapi/acquiring/v1.0/payments") return Response.json({ Data: { Operation: [...bank.values()] }, Meta: { totalPages: 1 } });
  const id = url.pathname.split("/").at(-1)!;
  assert(bank.has(id), "Only known fixture operations can be read");
  return Response.json({ Data: { Operation: [bank.get(id)] }, Meta: { totalPages: 1 } });
};
async function fixture() {
  const order = await prisma.order.create({ data: { number: `${prefix}-${orderIds.length}`, status: "AWAITING_PAYMENT", customerName: "QA-only synthetic buyer", customerEmail: "fixture@example.test", customerPhone: "+79990000000", shippingAddress: "QA-only", subtotal: 150, total: 150, deliveryPrice: 0, items: { create: { productName: "QA-only fixture", sku: prefix, quantity: 3, unitPrice: 50, totalPrice: 150 } }, payment: { create: { provider: "tochka", amount: 150 } } }, include: { payment: true } });
  orderIds.push(order.id); paymentIds.push(order.payment!.id); return order;
}
try {
  for (const [key, value] of [["legal.seller", "QA-only operator"], ["legal.address", "QA-only address"], ["contacts.email", "operator@example.test"]]) await prisma.siteSetting.upsert({ where: { key }, create: { key, value, group: "qa" }, update: { value } });
  await prisma.siteSetting.upsert({ where: { key: TOCHKA_SETTING }, create: { key: TOCHKA_SETTING, group: "integrations", value: config }, update: { value: config } });
  const order = await fixture();
  const attempts = await Promise.allSettled(Array.from({ length: 5 }, () => createOnlinePayment(order.id)));
  assert(attempts.some(item => item.status === "fulfilled")); assert.equal(posts, 1);
  const stored = await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } }); assert(stored.externalId);
  const remote = bank.get(stored.externalId)!;
  for (const change of [{ amount: 1 }, { merchantId: "wrong" }, { paymentLinkId: "wrong" }, { customerCode: "wrong" }]) await assert.rejects(applyTochkaPayment(stored.id, { ...remote, ...change, status: "APPROVED" }), /payment-mismatch/);
  await applyTochkaPayment(stored.id, { ...remote, status: "AUTHORIZED" });
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "AWAITING_PAYMENT");
  await Promise.all(Array.from({ length: 5 }, () => applyTochkaPayment(stored.id, { ...remote, status: "APPROVED" })));
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: stored.id } })).status, "PAID");
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "PAID");
  assert.equal(await prisma.auditLog.count({ where: { entityId: stored.id, action: "payment.verified", after: { path: ["status"], equals: "PAID" } } }), 1);

  const lost = await fixture(); loseNextResponse = true;
  await assert.rejects(createOnlinePayment(lost.id), /Synthetic lost response/); assert.equal(posts, 2);
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { orderId: lost.id } })).externalId, null);
  assert.equal(await createOnlinePayment(lost.id), remote.paymentLink); assert.equal(posts, 2);
  const restored = await prisma.payment.findUniqueOrThrow({ where: { orderId: lost.id } }); assert(restored.externalId);
  const restoredRemote = bank.get(restored.externalId)!;
  bank.set(restored.externalId, { ...restoredRemote, status: "APPROVED" });
  await prisma.siteSetting.update({ where: { key: TOCHKA_SETTING }, data: { value: { ...config, enabled: false } } });
  await reconcileTochkaPayments();
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: lost.id } })).status, "PAID"); assert.equal(posts, 2);
  const disabled = await fixture(); await assert.rejects(createOnlinePayment(disabled.id), /payment-not-configured/); assert.equal(posts, 2);
  console.log("PASS: real PostgreSQL locks, five concurrent clicks → one link, hold ≠ paid, immutable binding, idempotent confirmation, lost-response recovery, reconciliation after disablement. Fixture bank only; no real charges.");
} finally {
  globalThis.fetch = originalFetch;
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: paymentIds } } });
  if (oldConfig) await prisma.siteSetting.upsert({ where: { key: TOCHKA_SETTING }, create: { ...oldConfig, value: oldConfig.value ?? Prisma.JsonNull }, update: { value: oldConfig.value ?? Prisma.JsonNull, group: oldConfig.group } }); else await prisma.siteSetting.deleteMany({ where: { key: TOCHKA_SETTING } });
  await prisma.siteSetting.deleteMany({ where: { key: { in: operatorKeys } } });
  for (const setting of oldOperator) await prisma.siteSetting.create({ data: { ...setting, value: setting.value ?? Prisma.JsonNull } });
  await prisma.$disconnect();
}
