import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { operatorReady } from "@/lib/privacy";
import { getTochkaConfig, tochkaReady, type TochkaConfig } from "@/lib/tochka/config";
import { getTochkaOperation, operationSchema, tochkaPaymentUrl, tochkaRequest, type TochkaOperation } from "@/lib/tochka/client";
import { cloudReady, getCloudConfig } from "@/lib/cloudkassir/config";
import { prepareFiscalReceipt, queueDerivedReceipt } from "@/lib/cloudkassir/lifecycle";
import { writeDiagnostic } from "@/lib/diagnostics";

const bindingSchema = z.object({ version: z.literal(1), requestedAt: z.iso.datetime(), customerCode: z.string(), merchantId: z.string(), paymentLinkId: z.string(), fiscalReceiptId: z.string().optional() });
export async function onlinePaymentReady() {
  const config = await getTochkaConfig();
  return tochkaReady(config) && (config.receiptMode !== "cloudkassir" || cloudReady(await getCloudConfig()));
}
export function isOnlineProvider(provider?: string) { return provider === "tochka" || provider === "yookassa"; }

export async function applyTochkaPayment(paymentId: string, remote: TochkaOperation) {
  return prisma.$transaction(async tx => {
    // Same lock order as checkout/deletion: config lock before payment row lock.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412026)`;
    await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = ${paymentId} FOR UPDATE`;
    const payment = await tx.payment.findUnique({ where: { id: paymentId }, include: { order: true } });
    if (!payment || payment.provider !== "tochka") throw new Error("payment-state");
    const binding = bindingSchema.parse(payment.payload);
    if (payment.order.currency !== "RUB") throw new Error("payment-currency");
    if ((payment.externalId && payment.externalId !== remote.operationId) || remote.paymentLinkId !== binding.paymentLinkId || remote.customerCode !== binding.customerCode || remote.merchantId !== binding.merchantId || Number(remote.amount) !== Number(payment.amount) || Number(payment.amount) !== Number(payment.order.total)) throw new Error("payment-mismatch");
    if (!payment.externalId) await tx.payment.update({ where: { id: payment.id }, data: { externalId: remote.operationId } });
    if (binding.fiscalReceiptId && remote.status === "REFUNDED_PARTIALLY") {
      await tx.payment.updateMany({ where: { id: payment.id, refundReviewRequired: false }, data: { refundReviewRequired: true } });
      await tx.fiscalReceipt.updateMany({ where: { orderId: payment.orderId, status: "PENDING", firstAttemptAt: null }, data: { status: "MANUAL_REVIEW", errorCode: "partial-refund" } });
      return; // Exact returned positions/amounts must be reconciled, never guessed.
    }
    const status = remote.status === "APPROVED" ? "PAID" : remote.status === "EXPIRED" ? "CANCELED" : remote.status === "AUTHORIZED" ? "AUTHORIZED" : remote.status === "REFUNDED" && binding.fiscalReceiptId ? "REFUNDED" : null;
    if (!status) return;
    const updated = await tx.payment.updateMany({ where: { id: payment.id, status: { in: status === "REFUNDED" ? ["PENDING", "AUTHORIZED", "PAID"] : status === "AUTHORIZED" ? ["PENDING"] : ["PENDING", "AUTHORIZED"] } }, data: { status, ...(status === "PAID" ? { paidAt: new Date() } : {}) } });
    if (!updated.count) return;
    if (status === "PAID") await tx.order.updateMany({ where: { id: payment.orderId, status: { in: ["NEW", "APPROVED", "AWAITING_PAYMENT"] } }, data: { status: "PAID" } });
    if (binding.fiscalReceiptId && status === "PAID") {
      await tx.fiscalReceipt.updateMany({ where: { id: binding.fiscalReceiptId, orderId: payment.orderId, kind: "PREPAYMENT", status: "WAITING_PAYMENT" }, data: { status: "PENDING", nextAttemptAt: new Date() } });
    }
    if (binding.fiscalReceiptId && status === "REFUNDED") {
      await tx.order.update({ where: { id: payment.orderId }, data: { status: "REFUNDED" } });
      if (payment.status !== "PAID" || payment.refundReviewRequired) {
        await tx.fiscalReceipt.updateMany({ where: { orderId: payment.orderId, firstAttemptAt: null, status: { in: ["WAITING_PAYMENT", "PENDING"] } }, data: { status: "MANUAL_REVIEW", errorCode: "refund-reconciliation" } });
        await tx.payment.update({ where: { id: payment.id }, data: { refundReviewRequired: true } });
      } else await queueDerivedReceipt(tx, payment.orderId, "REFUND");
    }
    if (binding.fiscalReceiptId && status === "CANCELED") await tx.fiscalReceipt.updateMany({ where: { id: binding.fiscalReceiptId, status: "WAITING_PAYMENT" }, data: { status: "CANCELED" } });
    await tx.auditLog.create({ data: { action: "payment.verified", entityType: "Payment", entityId: payment.id, after: { provider: "tochka", externalId: remote.operationId, status } } });
  });
}

export async function recoverTochkaOperation(config: TochkaConfig, paymentId: string, requestedAt: string) {
  // A unique paymentLinkId is NOT a documented idempotency key. After a timeout
  // or crash, look up the existing link; never blindly repeat its creation POST.
  const fromDate = new Date(Date.parse(requestedAt) - 86400000).toISOString().slice(0, 10);
  const toDate = new Date().toISOString().slice(0, 10);
  for (let page = 1; page <= 20; page++) {
    const result = z.object({ Data: z.object({ Operation: z.array(operationSchema) }), Meta: z.object({ totalPages: z.number().int().min(0) }) }).parse(await tochkaRequest(config, `acquiring/v1.0/payments?customerCode=${encodeURIComponent(config.customerCode)}&fromDate=${fromDate}&toDate=${toDate}&page=${page}&perPage=1000`));
    const matches = result.Data.Operation.filter(item => item.paymentLinkId === paymentId);
    if (matches.length > 1) throw new Error("payment-duplicate-bank-link");
    if (matches[0]) return getTochkaOperation(config, matches[0].operationId);
    if (page >= result.Meta.totalPages) return null;
  }
  throw new Error("payment-reconciliation-required");
}

export async function refreshTochkaPayment(paymentId: string) {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment || payment.provider !== "tochka") throw new Error("payment-state");
  const binding = bindingSchema.parse(payment.payload);
  const config = await getTochkaConfig();
  if (config.customerCode !== binding.customerCode || config.merchantId !== binding.merchantId) throw new Error("payment-config-changed");
  const remote = payment.externalId ? await getTochkaOperation(config, payment.externalId) : await recoverTochkaOperation(config, payment.id, binding.requestedAt);
  if (!remote) return null;
  await applyTochkaPayment(payment.id, remote);
  return remote;
}

export async function refreshPayment(externalId: string) {
  const payment = await prisma.payment.findUnique({ where: { externalId } });
  if (!payment) return;
  if (payment.provider === "yookassa-online") return (await import("@/lib/yookassa/payments")).refreshYooKassaPayment(externalId);
  if (payment.provider === "yookassa") return (await import("@/lib/legacy-yookassa")).refreshPayment(externalId);
  if (payment.provider === "tochka") await refreshTochkaPayment(payment.id);
}

export async function createOnlinePayment(orderId: string) {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { payment: true, items: true } });
  if (order.kind === "APPLICATION" || order.deletedAt) throw new Error("payment-state");
  const payment = order.payment;
  if (!payment || !isOnlineProvider(payment.provider) || payment.status !== "PENDING" || !["NEW", "APPROVED", "AWAITING_PAYMENT"].includes(order.status)) throw new Error("payment-state");
  if (payment.provider === "yookassa") {
    // Reopen previously created legacy links, but never create new ones.
    if (!payment.externalId) throw new Error("legacy-payment-not-created");
    return (await import("@/lib/legacy-yookassa")).createOnlinePayment(orderId);
  }
  if (order.currency !== "RUB") throw new Error("payment-currency");
  if (payment.externalId || payment.payload !== null) {
    const remote = await refreshTochkaPayment(payment.id);
    if (!remote) throw new Error("payment-reconciliation-required");
    return tochkaPaymentUrl(remote);
  }
  if (!await operatorReady()) throw new Error("personal-data-not-ready");
  const claim = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412026)`;
    await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = ${payment.id} FOR UPDATE`;
    const current = await tx.payment.findUniqueOrThrow({ where: { id: payment.id }, include: { order: true } });
    if (current.status !== "PENDING" || !["NEW", "APPROVED", "AWAITING_PAYMENT"].includes(current.order.status)) throw new Error("payment-state");
    if (current.externalId || current.payload !== null) return null;
    const config = await getTochkaConfig(tx);
    if (!tochkaReady(config)) throw new Error("payment-not-configured");
    const fiscalReceiptId = config.receiptMode === "cloudkassir" ? await prepareFiscalReceipt(tx, orderId, await getCloudConfig(tx)) : undefined;
    const binding = { version: 1 as const, requestedAt: new Date().toISOString(), customerCode: config.customerCode, merchantId: config.merchantId, paymentLinkId: payment.id, ...(fiscalReceiptId ? { fiscalReceiptId } : {}) };
    await tx.payment.update({ where: { id: payment.id }, data: { payload: binding } });
    return { config, binding };
  });
  if (!claim) {
    const remote = await refreshTochkaPayment(payment.id);
    if (!remote) throw new Error("payment-reconciliation-required");
    return tochkaPaymentUrl(remote);
  }
  const { config } = claim;
  const url = new URL(`/checkout/success/${encodeURIComponent(order.number)}/`, process.env.NEXT_PUBLIC_SITE_URL ?? "https://sidzen.shop");
  const Data = {
    customerCode: config.customerCode, merchantId: config.merchantId, amount: Number(order.total), purpose: `Заказ ${order.number}`.slice(0, 140), paymentLinkId: payment.id,
    paymentMode: [...(config.card ? ["card"] : []), ...(config.sbp ? ["sbp"] : [])], preAuthorization: false, saveCard: false, ttl: 1440,
    redirectUrl: url.href, failRedirectUrl: `${url.href}?error=payment`,
    ...(config.receiptMode === "provider" ? { taxSystemCode: config.taxSystemCode, Client: { email: order.customerEmail }, Items: [
      ...order.items.map(item => ({ name: item.productName.slice(0, 256), amount: Number(item.unitPrice), quantity: item.quantity, vatType: config.vatType, paymentMethod: "full_prepayment", paymentObject: "goods", measure: "шт." })),
      ...(Number(order.deliveryPrice) > 0 ? [{ name: "Доставка", amount: Number(order.deliveryPrice), quantity: 1, vatType: config.vatType, paymentMethod: "full_prepayment", paymentObject: "service", measure: "шт." }] : []),
    ] } : {}),
  };
  const response = z.object({ Data: z.object({ operationId: z.string().min(1).max(100), amount: z.union([z.number(), z.string()]), merchantId: z.string().optional(), paymentLinkId: z.string().optional() }) }).parse(await tochkaRequest(config, config.receiptMode === "provider" ? "acquiring/v1.0/payments_with_receipt" : "acquiring/v1.0/payments", { Data }));
  if (Number(response.Data.amount) !== Number(order.total) || (response.Data.merchantId && response.Data.merchantId !== config.merchantId) || (response.Data.paymentLinkId && response.Data.paymentLinkId !== payment.id)) throw new Error("payment-mismatch");
  await prisma.payment.updateMany({ where: { id: payment.id, externalId: null }, data: { externalId: response.Data.operationId } });
  const remote = await refreshTochkaPayment(payment.id);
  if (!remote) throw new Error("payment-reconciliation-required");
  return tochkaPaymentUrl(remote);
}

export async function reconcileTochkaPayments(shouldStop = () => false) {
  // New money / owed prepayment checks must not wait behind years of paid
  // history. Reserve capacity for refund checks while prioritizing live links.
  const pending = await prisma.payment.findMany({ where: { provider: "tochka", status: { in: ["PENDING", "AUTHORIZED"] }, OR: [{ externalId: { not: null } }, { payload: { path: ["version"], equals: 1 } }] }, orderBy: { updatedAt: "asc" }, take: 8 });
  const paid = await prisma.payment.findMany({ where: { provider: "tochka", status: "PAID", order: { fiscalReceipts: { some: { kind: "PREPAYMENT" } } } }, orderBy: { updatedAt: "asc" }, take: 10 - pending.length });
  const payments = [...pending, ...paid];
  const deadline = Date.now() + 20_000;
  for (const payment of payments) {
    if (shouldStop() || Date.now() >= deadline) break;
    try { await refreshTochkaPayment(payment.id); }
    catch { await writeDiagnostic("payment.reconcile.failed"); }
    finally { await prisma.payment.updateMany({ where: { id: payment.id, status: { in: ["PENDING", "AUTHORIZED", "PAID"] } }, data: { updatedAt: new Date() } }); }
  }
}
