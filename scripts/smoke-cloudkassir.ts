// All provider calls are intercepted; disposable PostgreSQL only, no charges.
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { encryptSecret } from "../src/lib/integration-secrets";
import { CLOUD_SETTING, cloudSchema } from "../src/lib/cloudkassir/config";
import { TOCHKA_SETTING } from "../src/lib/tochka/config";
import { applyTochkaPayment, createOnlinePayment, onlinePaymentReady } from "../src/lib/payments";
import { queueDerivedReceipt, readFiscalPayload } from "../src/lib/cloudkassir/lifecycle";
import { processFiscalReceipt, SAFE_RETRY_MS } from "../src/lib/cloudkassir/worker";
import { acceptCloudNotification } from "../src/lib/cloudkassir/webhook";
import { recoverFiscalReceipt } from "../src/lib/cloudkassir/recovery";
import { operatorReady } from "../src/lib/privacy";
import type { TochkaOperation } from "../src/lib/tochka/client";

const db = new URL(process.env.DATABASE_URL || "");
assert(["localhost", "127.0.0.1"].includes(db.hostname) && db.pathname === "/shop_qa");
assert(process.env.AUTH_SECRET && process.env.PERSONAL_DATA_RF_STORAGE_CONFIRMED === "true");
const keys = [CLOUD_SETTING, TOCHKA_SETTING, "legal.seller", "legal.address", "contacts.email"];
const old = await prisma.siteSetting.findMany({ where: { key: { in: keys } } });
const auditBefore = (await prisma.auditLog.findMany({ select: { id: true } })).map(row => row.id);
const config = cloudSchema.parse({ enabled: true, publicId: "synthetic-qa-terminal", apiSecret: "synthetic-qa-secret", inn: "7707083893", deviceNumber: "12345", fiscalNumber: "9999078900005430", productionConfirmed: true, operatorReviewed: true, taxConfirmed: true, checkedAt: new Date().toISOString() });
const bankConfig = { enabled: true, token: encryptSecret("synthetic-qa-bank-token-no-real-access", TOCHKA_SETTING), customerCode: "1234567ab", merchantId: "200000000001097", card: true, sbp: true, receiptMode: "cloudkassir", vatType: "none", taxSystemCode: "usn_income", externalReceiptsConfirmed: false, checkedAt: new Date().toISOString() };
const prefix = `CLOUDQA-${randomUUID().slice(0, 8)}`, orderIds: string[] = [];
const actor = await prisma.user.create({ data: { email: `${prefix.toLowerCase()}@example.test`, name: "Synthetic fiscal QA", passwordHash: "synthetic-disabled-no-login" } });
const bank = new Map<string, TochkaOperation>(), receipts = new Map<string, { id: string; body: ReturnType<typeof readFiscalPayload> }>();
let bankPosts = 0, receiptPosts = 0, lose = false;
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.origin === "https://enter.tochka.com") {
    if (init?.method === "POST") {
      assert.equal(url.pathname, "/uapi/acquiring/v1.0/payments", "NO bank-side receipt, no duplicate fiscalization");
      const body = JSON.parse(String(init.body)).Data;
      for (const key of ["Items", "Client", "taxSystemCode"]) assert(!(key in body));
      bankPosts++;
      const remote: TochkaOperation = { operationId: randomUUID(), status: "CREATED", amount: body.amount, customerCode: body.customerCode, merchantId: body.merchantId, paymentLinkId: body.paymentLinkId, paymentLink: "https://merch.tochka.com/qa-only" };
      bank.set(remote.operationId, remote); await new Promise(resolve => setTimeout(resolve, 30)); return Response.json({ Data: remote });
    }
    const remote = bank.get(url.pathname.split("/").at(-1)!); assert(remote); return Response.json({ Data: { Operation: [remote] }, Meta: { totalPages: 1 } });
  }
  assert.equal(url.origin, "https://api.cloudpayments.ru", "Unknown provider must not be contacted");
  assert.equal((init?.headers as Record<string, string>).Authorization, `Basic ${Buffer.from(`${config.publicId}:${config.apiSecret}`).toString("base64")}`);
  const body = JSON.parse(String(init?.body));
  if (url.pathname === "/kkt/receipt") {
    receiptPosts++;
    const key = (init?.headers as Record<string, string>)["X-Request-ID"]; assert(key);
    let saved = receipts.get(key); if (!saved) { saved = { id: randomUUID(), body }; receipts.set(key, saved); } else assert.deepEqual(saved.body, body);
    assert.equal(body.CustomerReceipt.TaxationSystem, 1); assert(body.CustomerReceipt.Items.every((item: { Vat: unknown }) => item.Vat === null));
    assert(!String(init?.body).includes("+79990000000") && !String(init?.body).includes("QA-only buyer"));
    if (lose) { lose = false; throw new Error("Synthetic lost response"); }
    return Response.json({ Success: true, Model: { Id: saved.id, ReceiptLocalUrl: `https://receipts.ru/${saved.id}` } });
  }
  const saved = [...receipts.values()].find(row => row.id === body.Id); assert(saved, "Only fixture receipts allowed");
  if (url.pathname === "/kkt/receipt/status/get") return Response.json({ Success: true, Model: "Processed" });
  assert.equal(url.pathname, "/kkt/receipt/get");
  return Response.json({ Success: true, Model: { ...saved.body.CustomerReceipt, AdditionalData: { Id: saved.id, InvoiceId: saved.body.InvoiceId, OrganizationInn: saved.body.Inn, Type: saved.body.Type, Amount: saved.body.CustomerReceipt.Items.reduce((sum, item) => sum + item.Amount, 0), DocumentNumber: "123", FiscalSign: "123", FiscalNumber: config.fiscalNumber, RegNumber: "123", DateTime: new Date().toISOString(), OfdReceiptUrl: `https://receipts.ru/${saved.id}` } } });
};
async function setting(key: string, value: Prisma.InputJsonValue) {
  const group = key.startsWith("integrations.") ? "integrations" : "qa";
  await prisma.siteSetting.upsert({ where: { key }, create: { key, group, value }, update: { value, group } });
}
async function fixture() {
  const row = await prisma.order.create({ data: { number: `${prefix}-${orderIds.length}`, status: "AWAITING_PAYMENT", customerName: "QA-only buyer", customerEmail: "fixture@example.test", customerPhone: "+79990000000", subtotal: 150, discount: 0.01, total: 149.99, deliveryPrice: 0, items: { create: { productName: "QA-only fixture", sku: prefix, quantity: 3, unitPrice: 50, totalPrice: 150 } }, payment: { create: { provider: "tochka", amount: 149.99 } } }, include: { payment: true } });
  orderIds.push(row.id); return row;
}
async function due(orderId: string) { await prisma.fiscalReceipt.updateMany({ where: { orderId, status: { in: ["PENDING", "SENDING", "QUEUED"] } }, data: { nextAttemptAt: new Date(Date.now() - 1000), leaseUntil: null } }); }
async function paid() {
  const row = await fixture(); await createOnlinePayment(row.id);
  const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId: row.id } }); const remote = bank.get(payment.externalId!)!;
  await Promise.all(Array.from({ length: 5 }, () => applyTochkaPayment(payment.id, { ...remote, status: "APPROVED" })));
  return { order: row, payment, remote };
}
try {
  for (const [key, value] of [["legal.seller", "QA operator"], ["legal.address", "QA address"], ["contacts.email", "operator@example.test"]]) await setting(key, value);
  await setting(TOCHKA_SETTING, bankConfig); await setting(CLOUD_SETTING, { ...config, apiSecret: encryptSecret(config.apiSecret, CLOUD_SETTING) });
  assert.equal(await operatorReady(), true, "Synthetic operator contacts must be visible even on a fresh database");
  assert.equal(await onlinePaymentReady(), true);
  const initial = await fixture(); const attempts = await Promise.allSettled(Array.from({ length: 5 }, () => createOnlinePayment(initial.id)));
  assert(attempts.some(row => row.status === "fulfilled"), "At least one concurrent claim must create the fixture payment");
  assert.equal(bankPosts, 1); assert.equal(await prisma.fiscalReceipt.count({ where: { orderId: initial.id } }), 1);
  await processFiscalReceipt(); assert.equal(receiptPosts, 0, "No receipt before bank confirmation");
  const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId: initial.id } }); const remote = bank.get(payment.externalId!)!;
  await Promise.all(Array.from({ length: 5 }, () => applyTochkaPayment(payment.id, { ...remote, status: "APPROVED" })));
  await Promise.all(Array.from({ length: 5 }, () => processFiscalReceipt())); assert.equal(receiptPosts, 1);
  let row = await prisma.fiscalReceipt.findFirstOrThrow({ where: { orderId: initial.id } }); assert(!row.request.includes("fixture@example.test"));
  assert.equal(row.status, "QUEUED"); await due(initial.id); await processFiscalReceipt();
  row = await prisma.fiscalReceipt.findUniqueOrThrow({ where: { id: row.id } }); assert.equal(row.status, "PROCESSED");
  const callback = new URLSearchParams({ Id: row.externalId!, InvoiceId: row.id, Inn: config.inn, Type: "Income", Amount: "149.99", Url: "https://evil.test/phishing", Receipt: JSON.stringify(readFiscalPayload(row).CustomerReceipt), DocumentNumber: "123", FiscalSign: "123", FiscalNumber: config.fiscalNumber, RegNumber: "123", DateTime: new Date().toISOString() }).toString();
  const sign = (body: string) => createHmac("sha256", config.apiSecret).update(body).digest("base64");
  await assert.rejects(acceptCloudNotification(callback, "wrong"), /signature/);
  const altered = callback.replace("Amount=149.99", "Amount=1"); await assert.rejects(acceptCloudNotification(altered, sign(altered)), /binding/);
  await Promise.all(Array.from({ length: 5 }, () => acceptCloudNotification(callback, sign(callback))));
  assert.match((await prisma.fiscalReceipt.findUniqueOrThrow({ where: { id: row.id } })).receiptUrl!, /^https:\/\/receipts.ru\//);
  await Promise.all(Array.from({ length: 5 }, () => prisma.$transaction(async tx => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412026)`; await queueDerivedReceipt(tx, initial.id, "SETTLEMENT"); })));
  assert.equal(await prisma.fiscalReceipt.count({ where: { orderId: initial.id, kind: "SETTLEMENT" } }), 1);
  await processFiscalReceipt(); await due(initial.id); await processFiscalReceipt();
  const settle = await prisma.fiscalReceipt.findFirstOrThrow({ where: { orderId: initial.id, kind: "SETTLEMENT" } }); assert.equal(settle.status, "PROCESSED"); assert.equal(readFiscalPayload(settle).CustomerReceipt.Amounts.Electronic, 0);
  await Promise.all(Array.from({ length: 5 }, () => applyTochkaPayment(payment.id, { ...remote, status: "REFUNDED" })));
  assert.equal(await prisma.fiscalReceipt.count({ where: { orderId: initial.id, kind: "REFUND" } }), 1);
  await processFiscalReceipt(); await due(initial.id); await processFiscalReceipt();
  const refund = await prisma.fiscalReceipt.findFirstOrThrow({ where: { orderId: initial.id, kind: "REFUND" } }); assert.equal(refund.status, "PROCESSED"); assert.equal(readFiscalPayload(refund).Type, "IncomeReturn");
  const lost = await paid(); lose = true; await processFiscalReceipt();
  let lostRow = await prisma.fiscalReceipt.findFirstOrThrow({ where: { orderId: lost.order.id } }); assert.equal(lostRow.externalId, null);
  await due(lost.order.id); await processFiscalReceipt(); lostRow = await prisma.fiscalReceipt.findUniqueOrThrow({ where: { id: lostRow.id } }); assert(lostRow.externalId); assert.equal(receipts.size, 4, "Lost response retried with same idempotency key");
  await due(lost.order.id); await processFiscalReceipt();
  const uncertain = await paid(); lose = true; await processFiscalReceipt();
  const uncertainRow = await prisma.fiscalReceipt.findFirstOrThrow({ where: { orderId: uncertain.order.id } }); const countBefore = receiptPosts;
  await prisma.fiscalReceipt.update({ where: { id: uncertainRow.id }, data: { firstAttemptAt: new Date(Date.now() - SAFE_RETRY_MS - 1000), nextAttemptAt: new Date(Date.now() - 1000) } });
  await processFiscalReceipt(); assert.equal(receiptPosts, countBefore); assert.equal((await prisma.fiscalReceipt.findUniqueOrThrow({ where: { id: uncertainRow.id } })).status, "MANUAL_REVIEW");
  const externalId = receipts.get(uncertainRow.requestId)!.id;
  await assert.rejects(recoverFiscalReceipt(uncertainRow.id, row.externalId!, actor.id), /receipt-binding/);
  await recoverFiscalReceipt(uncertainRow.id, externalId, actor.id); assert.equal(receiptPosts, countBefore);
  const partial = await paid(); await applyTochkaPayment(partial.payment.id, { ...partial.remote, status: "REFUNDED_PARTIALLY" });
  assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: partial.payment.id } })).refundReviewRequired, true);
  await assert.rejects(prisma.$transaction(tx => queueDerivedReceipt(tx, partial.order.id, "SETTLEMENT")), /fiscal-unpaid/);
  await applyTochkaPayment(partial.payment.id, { ...partial.remote, status: "REFUNDED" }); assert.equal(await prisma.fiscalReceipt.count({ where: { orderId: partial.order.id, kind: "REFUND" } }), 0);
  const disabled = await paid(); await setting(CLOUD_SETTING, { ...config, enabled: false, apiSecret: encryptSecret(config.apiSecret, CLOUD_SETTING) });
  assert.equal(await onlinePaymentReady(), false); await processFiscalReceipt();
  assert.equal((await prisma.fiscalReceipt.findFirstOrThrow({ where: { orderId: disabled.order.id } })).status, "QUEUED", "Owed receipts continue after disablement");
  const blocked = await fixture(); await assert.rejects(createOnlinePayment(blocked.id), /cloud-not-ready/);
  console.log("PASS CloudKassir: PostgreSQL concurrent claims, no bank fiscalization, prepayment → settlement → full refund, HMAC/binding, encrypted email, no duplicate receipts, lost response, bounded retry window, read-only recovery, partial refund guard, owed receipts after disablement. All APIs synthetic; no real charges/receipts.");
} finally {
  globalThis.fetch = realFetch;
  await prisma.fiscalReceipt.deleteMany({ where: { orderId: { in: orderIds } } }); await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.auditLog.deleteMany({ where: { id: { notIn: auditBefore } } });
  await prisma.user.delete({ where: { id: actor.id } });
  for (const key of keys) { const row = old.find(item => item.key === key); if (row) await prisma.siteSetting.upsert({ where: { key }, create: { ...row, value: row.value ?? Prisma.JsonNull }, update: { value: row.value ?? Prisma.JsonNull, group: row.group } }); else await prisma.siteSetting.deleteMany({ where: { key } }); }
  await prisma.$disconnect();
}
