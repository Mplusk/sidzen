import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { encryptSecret } from "../src/lib/integration-secrets";
import { YOOKASSA_ONLINE_SETTING } from "../src/lib/yookassa/config";
import { createYooKassaPayment, reconcileYooKassaPayment, refreshYooKassaPayment } from "../src/lib/yookassa/payments";
import { processYooKassaSettlement, queueYooKassaSettlement } from "../src/lib/yookassa/settlements";

if (!process.env.DATABASE_URL?.includes("shop_qa")) throw new Error("Synthetic QA database required");
const keys = [YOOKASSA_ONLINE_SETTING, "legal.seller", "legal.address", "contacts.email"];
const prior = await prisma.siteSetting.findMany({ where: { key: { in: keys } } });
const orders: string[] = [];
const originalFetch = globalThis.fetch;
let externalId = "28646d50-000f-5000-a000-1fe4f81e5e88";
const receiptId = "rt-2bf4503f-0001-0050-0e94-761f7451b8a6";
let body: Record<string, unknown> | undefined;
let paid = false, first = true, creates = 0, key = "";
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (!url.startsWith("https://api.yookassa.ru/v3/")) throw new Error("unexpected network");
  if (url.endsWith("/payments") && init?.method === "POST") {
    creates++;
    const header = new Headers(init.headers).get("Idempotence-Key") ?? "";
    if (key) assert.equal(header, key); else key = header;
    const request = JSON.parse(String(init.body));
    if (body) assert.deepEqual(request, body); else body = request;
    if (first) { first = false; throw new Error("lost response"); }
  }
  if (url.endsWith("/receipts") && init?.method === "POST") {
    const request = JSON.parse(String(init.body));
    assert.equal(request.payment_id, externalId); assert.equal(request.items[0].payment_mode, "full_payment");
    assert.equal(request.settlements[0].amount.value, "304.00");
    return Response.json({ id: receiptId, payment_id: externalId, type: "payment", status: "pending" });
  }
  if (url.endsWith(`/receipts/${receiptId}`)) return Response.json({ id: receiptId, payment_id: externalId, type: "payment", status: "succeeded" });
  assert(body);
  return Response.json({ id: externalId, status: paid ? "succeeded" : "pending", paid, test: false, amount: { value: "304.00", currency: "RUB" }, metadata: body.metadata, recipient: { account_id: "123" }, receipt_registration: paid ? "succeeded" : "pending", confirmation: { confirmation_url: "https://yookassa.ru/checkout/payments/test" } });
};
try {
  for (const [setting, value] of [["legal.seller", "QA seller"], ["legal.address", "QA address"], ["contacts.email", "qa@example.test"]]) {
    await prisma.siteSetting.upsert({ where: { key: setting }, create: { key: setting, value, group: "qa" }, update: { value, group: "qa" } });
  }
  const config = { enabled: true, shopId: "123", secret: encryptSecret("fixture", YOOKASSA_ONLINE_SETTING), receiptsConfirmed: true, checkedAt: new Date().toISOString() };
  await prisma.siteSetting.upsert({ where: { key: YOOKASSA_ONLINE_SETTING }, create: { key: YOOKASSA_ONLINE_SETTING, value: config, group: "integrations" }, update: { value: config, group: "integrations" } });
  const order = await prisma.order.create({ data: { number: `QA-YOO-${Date.now()}`, kind: "ORDER", status: "AWAITING_PAYMENT", customerName: "QA buyer", customerEmail: "qa@example.test", customerPhone: "+79990000000", subtotal: 240, deliveryPrice: 64, total: 304, items: { create: { productName: "QA item", quantity: 1, unitPrice: 240, totalPrice: 240 } }, payment: { create: { provider: "yookassa-online", amount: 304 } } }, include: { payment: true } });
  orders.push(order.id);
  await assert.rejects(createYooKassaPayment(order.id), /lost response/);
  assert.equal(await createYooKassaPayment(order.id), "https://yookassa.ru/checkout/payments/test");
  assert.equal(creates, 2); assert.equal(key, order.payment!.id);
  assert.equal((body!.receipt as { items: Array<{ payment_mode: string }> }).items[0].payment_mode, "full_prepayment");
  paid = true; await refreshYooKassaPayment(externalId);
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status, "PAID");
  await prisma.$transaction(async tx => { await queueYooKassaSettlement(tx, order.id); await tx.order.update({ where: { id: order.id }, data: { status: "DELIVERED" } }); });
  assert(await processYooKassaSettlement());
  await prisma.yooKassaSettlement.update({ where: { orderId: order.id }, data: { nextAttemptAt: new Date(0) } });
  assert(await processYooKassaSettlement());
  assert.equal((await prisma.yooKassaSettlement.findUniqueOrThrow({ where: { orderId: order.id } })).status, "PROCESSED");
  body = undefined; key = ""; first = true; creates = 0; paid = false;
  externalId = "28646d50-000f-5000-a000-1fe4f81e5e89";
  const uncertain = await prisma.order.create({ data: { number: `QA-YOO-REVIEW-${Date.now()}`, kind: "ORDER", status: "AWAITING_PAYMENT", customerName: "QA buyer", customerEmail: "qa@example.test", customerPhone: "+79990000000", subtotal: 240, deliveryPrice: 64, total: 304, items: { create: { productName: "QA item", quantity: 1, unitPrice: 240, totalPrice: 240 } }, payment: { create: { provider: "yookassa-online", amount: 304 } } }, include: { payment: true } });
  orders.push(uncertain.id);
  await assert.rejects(createYooKassaPayment(uncertain.id), /lost response/);
  const pending = await prisma.payment.findUniqueOrThrow({ where: { orderId: uncertain.id } });
  assert(pending.payload && typeof pending.payload === "object" && !Array.isArray(pending.payload));
  await prisma.payment.update({ where: { id: pending.id }, data: { payload: { ...pending.payload, firstAttemptAt: new Date(Date.now() - 24 * 3600000).toISOString() } } });
  await assert.rejects(createYooKassaPayment(uncertain.id), /payment-reconciliation-required/);
  assert.equal(creates, 1, "Never resend beyond the idempotency window");
  assert.equal(((await prisma.payment.findUniqueOrThrow({ where: { id: pending.id } })).payload as { reconciliationRequired: boolean }).reconciliationRequired, true);
  paid = true; await reconcileYooKassaPayment(uncertain.id, externalId);
  assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: uncertain.id } })).status, "PAID");
  console.log("YooKassa payment, idempotent retry, manual reconciliation and settlement: OK");
} finally {
  globalThis.fetch = originalFetch;
  await prisma.yooKassaSettlement.deleteMany({ where: { orderId: { in: orders } } });
  await prisma.order.deleteMany({ where: { id: { in: orders } } });
  await prisma.siteSetting.deleteMany({ where: { key: { in: keys } } });
  for (const row of prior) await prisma.siteSetting.create({ data: { ...row, value: row.value === null ? Prisma.JsonNull : row.value } });
  await prisma.$disconnect();
}
