import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/integration-secrets";
import { operatorReady } from "@/lib/privacy";
import { getYooKassaConfig, yookassaReady, type YooKassaConfig } from "./config";
import { receiptForOrder } from "./receipt";
import { releaseUnsentStock } from "@/lib/stock-reservations";
import { restoreExpiredOrderStock } from "@/lib/late-order-stock";
import { startOrderPaymentHold } from "@/lib/cart-stock-holds";
import { lockOrderProductsForCartReturn, removeUnchangedReturnedItems, returnOrderToCart } from "@/lib/order-cart-restore";
import { rateLimit } from "@/lib/rate-limit";
import { queueTelegramCancellation, queueTelegramLatePayment } from "@/lib/telegram/status";

const bindingSchema = z.object({ version: z.literal(1), shopId: z.string(), firstAttemptAt: z.iso.datetime(), request: z.string(), receiptStatus: z.string().optional(), reconciliationRequired: z.boolean().optional() });
const remoteSchema = z.object({ id: z.string().uuid(), status: z.enum(["pending", "waiting_for_capture", "succeeded", "canceled"]), paid: z.boolean(), test: z.boolean(), amount: z.object({ value: z.string(), currency: z.literal("RUB") }), metadata: z.object({ orderId: z.string(), paymentId: z.string() }), recipient: z.object({ account_id: z.string() }), confirmation: z.object({ confirmation_url: z.url().optional() }).optional(), receipt_registration: z.enum(["pending", "succeeded", "canceled"]).optional(), refunded_amount: z.object({ value: z.string(), currency: z.literal("RUB") }).optional() });
type RemotePayment = z.infer<typeof remoteSchema>;
const purpose = (id: string) => `yookassa.payment:${id}`;
const RETRY_MS = 23 * 60 * 60 * 1000;

export async function yookassaRequest(config: Pick<YooKassaConfig, "shopId" | "secret">, path: string, post?: { key: string; body: unknown }) {
  if (!config.shopId || !config.secret) throw new Error("payment-config");
  const response = await fetch(`https://api.yookassa.ru/v3/${path}`, { method: post ? "POST" : "GET", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000), headers: { Authorization: `Basic ${Buffer.from(`${config.shopId}:${config.secret}`).toString("base64")}`, "Content-Type": "application/json", ...(post ? { "Idempotence-Key": post.key } : {}) }, ...(post ? { body: JSON.stringify(post.body) } : {}) });
  if (!response.ok) throw new Error(`payment-provider-${response.status}`);
  return response.json();
}

function paymentUrl(payment: RemotePayment) {
  const value = payment.confirmation?.confirmation_url;
  if (!value || payment.status !== "pending") return null;
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || !["yookassa.ru", "yoomoney.ru"].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new Error("payment-url");
  return url.href;
}

export async function applyYooKassaPayment(remote: RemotePayment) {
  if (remote.test && (process.env.NODE_ENV === "production" || process.env.YOOKASSA_ALLOW_TEST !== "true")) throw new Error("test-payment-rejected");
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412026)`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412034)`;
    const payment = await tx.payment.findUnique({ where: { id: remote.metadata.paymentId }, include: { order: { include: { shipment: { select: { provider: true } } } } } });
    if (!payment || payment.provider !== "yookassa-online") throw new Error("payment-state");
    const binding = bindingSchema.parse(payment.payload);
    if (remote.recipient.account_id !== binding.shopId || remote.metadata.orderId !== payment.orderId || (payment.externalId && payment.externalId !== remote.id) || Number(remote.amount.value) !== Number(payment.amount) || Number(payment.amount) !== Number(payment.order.total) || payment.order.currency !== "RUB") throw new Error("payment-mismatch");
    const refunded = remote.refunded_amount ? Number(remote.refunded_amount.value) : 0;
    if (!Number.isFinite(refunded) || refunded < 0 || refunded > Number(payment.amount)) throw new Error("refund-mismatch");
    const status = refunded === Number(payment.amount) && refunded > 0 ? "REFUNDED" : remote.status === "succeeded" && remote.paid ? "PAID" : remote.status === "canceled" ? "CANCELED" : remote.status === "waiting_for_capture" ? "AUTHORIZED" : "PENDING";
    const partial = refunded > 0 && status !== "REFUNDED";
    const payload = { ...binding, reconciliationRequired: false, ...(remote.receipt_registration ? { receiptStatus: remote.receipt_registration } : {}) };
    // A verified cancellation is terminal: an out-of-order older webhook must
    // never revive an order whose inventory may already have been released.
    const nextStatus = payment.status === "CANCELED" || payment.status === "REFUNDED" || (payment.status === "PAID" && status !== "REFUNDED") ? payment.status : status;
    const paidAfterExpiry = nextStatus === "PAID" && status === "PAID" && payment.status !== "PAID" && !!payment.order.reservationExpiredAt && payment.order.status === "CANCELED" && !payment.order.deletedAt;
    const recoveredStock = paidAfterExpiry ? await restoreExpiredOrderStock(tx, payment.orderId) : false;
    if (paidAfterExpiry && recoveredStock) await removeUnchangedReturnedItems(tx, payment.orderId);
    await tx.payment.update({ where: { id: payment.id }, data: { externalId: remote.id, payload, status: nextStatus, ...(nextStatus === "PAID" && status === "PAID" && !payment.paidAt ? { paidAt: new Date() } : {}), ...(partial ? { refundReviewRequired: true } : {}) } });
    if (paidAfterExpiry) {
      await tx.order.update({ where: { id: payment.orderId }, data: { status: "PAID", statusChangedAt: new Date(), stockReviewRequired: !recoveredStock } });
      await queueTelegramLatePayment(tx, payment.orderId);
      await tx.auditLog.create({ data: { action: "order.stock.late-payment", entityType: "Order", entityId: payment.orderId, after: { stockRecovered: recoveredStock } } });
    } else if (nextStatus === "PAID" && status === "PAID" && !payment.order.deletedAt) await tx.order.updateMany({ where: { id: payment.orderId, status: { in: ["NEW", "APPROVED", "AWAITING_PAYMENT"] } }, data: { status: "PAID", reservationExpiresAt: null, checkoutCartId: null } });
    if (nextStatus === "CANCELED") {
      const returnCart = payment.order.kind === "ORDER" && ["NEW", "APPROVED", "AWAITING_PAYMENT"].includes(payment.order.status) && !payment.order.reservationExpiredAt;
      if (returnCart) await lockOrderProductsForCartReturn(tx, payment.orderId);
      const released = await releaseUnsentStock(tx, payment.orderId);
      if (returnCart && released) await returnOrderToCart(tx, payment.order);
      const canceledOrder = await tx.order.updateMany({ where: { id: payment.orderId, status: { in: ["NEW", "APPROVED", "AWAITING_PAYMENT"] } }, data: { status: "CANCELED", statusChangedAt: new Date(), reservationExpiresAt: null, checkoutCartId: null } });
      if (canceledOrder.count) await queueTelegramCancellation(tx, payment.orderId);
      await tx.ozonDeliveryJob.updateMany({ where: { shipment: { orderId: payment.orderId }, status: { notIn: ["CANCELED", "FINISHED"] } }, data: { cancelRequestedAt: new Date(), nextAttemptAt: new Date() } });
      await tx.cdekDeliveryJob.updateMany({ where: { shipment: { orderId: payment.orderId }, status: { notIn: ["CANCELED", "FINISHED"] } }, data: { cancelRequestedAt: new Date(), nextAttemptAt: new Date() } });
      if (payment.order.shipment?.provider === "fivepost-delivery") await tx.fivePostDeliveryJob.updateMany({ where: { shipment: { orderId: payment.orderId }, status: { notIn: ["CANCELED", "FINISHED"] } }, data: { cancelRequestedAt: new Date(), nextAttemptAt: new Date() } });
    }
    if (nextStatus === "REFUNDED") {
      // Returning money does not prove the physical goods came back. Only an
      // order that definitely never entered carrier processing is releasable.
      await releaseUnsentStock(tx, payment.orderId);
      await tx.order.updateMany({ where: { id: payment.orderId, status: { not: "REFUNDED" } }, data: { status: "REFUNDED", stockReviewRequired: false, reservationExpiresAt: null } });
      await tx.yooKassaSettlement.updateMany({ where: { orderId: payment.orderId, status: "PENDING", firstAttemptAt: null }, data: { status: "CANCELED" } });
      await tx.yooKassaSettlement.updateMany({ where: { orderId: payment.orderId, status: { in: ["SENDING", "QUEUED"] } }, data: { status: "MANUAL_REVIEW", errorCode: "refund-in-flight", leaseUntil: null } });
      await tx.ozonDeliveryJob.updateMany({ where: { shipment: { orderId: payment.orderId }, status: { notIn: ["CANCELED", "FINISHED"] } }, data: { cancelRequestedAt: new Date(), nextAttemptAt: new Date() } });
      await tx.cdekDeliveryJob.updateMany({ where: { shipment: { orderId: payment.orderId }, status: { notIn: ["CANCELED", "FINISHED"] } }, data: { cancelRequestedAt: new Date(), nextAttemptAt: new Date() } });
      if (payment.order.shipment?.provider === "fivepost-delivery") await tx.fivePostDeliveryJob.updateMany({ where: { shipment: { orderId: payment.orderId }, status: { notIn: ["CANCELED", "FINISHED"] } }, data: { cancelRequestedAt: new Date(), nextAttemptAt: new Date() } });
    }
    if (partial) await tx.yooKassaSettlement.updateMany({ where: { orderId: payment.orderId, status: "PENDING", firstAttemptAt: null }, data: { status: "MANUAL_REVIEW", errorCode: "partial-refund" } });
    if (partial) await tx.yooKassaSettlement.updateMany({ where: { orderId: payment.orderId, status: { in: ["SENDING", "QUEUED"] } }, data: { status: "MANUAL_REVIEW", errorCode: "refund-in-flight", leaseUntil: null } });
    if (payment.status !== nextStatus) await tx.auditLog.create({ data: { action: "payment.verified", entityType: "Payment", entityId: payment.id, after: { provider: "yookassa-online", externalId: remote.id, status: nextStatus } } });
  });
}

export async function refreshYooKassaPayment(externalId: string) {
  if (!z.string().uuid().safeParse(externalId).success) throw new Error("payment-id");
  const payment = await prisma.payment.findUnique({ where: { externalId } });
  if (!payment || payment.provider !== "yookassa-online") throw new Error("payment-state");
  const binding = bindingSchema.parse(payment.payload);
  const config = await getYooKassaConfig();
  if (config.shopId !== binding.shopId) throw new Error("payment-config-changed");
  const remote = remoteSchema.parse(await yookassaRequest(config, `payments/${externalId}`));
  if (remote.id !== externalId) throw new Error("payment-mismatch");
  await applyYooKassaPayment(remote);
  return remote;
}

/** Recover a payment whose creation response was lost before its ID was stored. */
export async function recoverUnboundYooKassaPayment(externalId: string) {
  if (!z.string().uuid().safeParse(externalId).success) throw new Error("payment-id");
  // Unknown public webhook IDs must not trigger unbounded provider requests.
  // A real lost response always leaves the signed creation binding in storage.
  const pending = await prisma.payment.findFirst({ where: { provider: "yookassa-online", externalId: null, status: { in: ["PENDING", "AUTHORIZED"] }, payload: { path: ["version"], equals: 1 } }, select: { id: true } });
  if (!pending || !rateLimit("yookassa-unbound-recovery", 30, 60_000).allowed) throw new Error("payment-state");
  const config = await getYooKassaConfig();
  const remote = remoteSchema.parse(await yookassaRequest(config, `payments/${externalId}`));
  if (remote.id !== externalId) throw new Error("payment-mismatch");
  // applyYooKassaPayment validates the stored encrypted binding, shop, order,
  // exact amount and any pre-existing external ID before changing anything.
  await applyYooKassaPayment(remote);
  return remote;
}

export async function reconcileYooKassaPayment(orderId: string, externalId: string) {
  if (!z.string().uuid().safeParse(externalId).success) throw new Error("payment-id");
  const payment = await prisma.payment.findUnique({ where: { orderId } });
  if (!payment || payment.provider !== "yookassa-online" || (payment.externalId && payment.externalId !== externalId)) throw new Error("payment-state");
  const binding = bindingSchema.parse(payment.payload);
  const config = await getYooKassaConfig();
  if (config.shopId !== binding.shopId) throw new Error("payment-config-changed");
  const remote = remoteSchema.parse(await yookassaRequest(config, `payments/${externalId}`));
  if (remote.id !== externalId || remote.metadata.paymentId !== payment.id || remote.metadata.orderId !== orderId) throw new Error("payment-mismatch");
  await applyYooKassaPayment(remote);
}

export async function createYooKassaPayment(orderId: string, options: { customerAttempt?: boolean } = {}) {
  if (!await operatorReady()) throw new Error("personal-data-not-ready");
  const claim = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412026)`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412034)`;
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { payment: true, items: true } });
    const payment = order.payment;
    if (order.deletedAt || order.personalDataErasedAt || order.reservationExpiredAt || (order.reservationExpiresAt && order.reservationExpiresAt <= new Date()) || !payment || payment.provider !== "yookassa-online" || !["PENDING", "AUTHORIZED"].includes(payment.status) || !["NEW", "AWAITING_PAYMENT", "APPROVED"].includes(order.status)) throw new Error("payment-state");
    const config = await getYooKassaConfig(tx);
    if (payment.externalId) return { config, payment, binding: bindingSchema.parse(payment.payload) };
    if (!yookassaReady(config)) throw new Error("payment-not-configured");
    if (payment.payload) return { config, payment, binding: bindingSchema.parse(payment.payload) };
    if (options.customerAttempt) await startOrderPaymentHold(tx, order);
    const receipt = receiptForOrder(order, "full_prepayment");
    const body = { amount: { value: Number(order.total).toFixed(2), currency: "RUB" }, capture: true, confirmation: { type: "redirect", return_url: new URL(`/checkout/success/${encodeURIComponent(order.number)}/`, process.env.NEXT_PUBLIC_SITE_URL ?? "https://sidzen.shop").href }, description: `Заказ ${order.number}`.slice(0, 128), metadata: { orderId: order.id, paymentId: payment.id }, receipt };
    const binding = { version: 1 as const, shopId: config.shopId, firstAttemptAt: new Date().toISOString(), request: encryptSecret(JSON.stringify(body), purpose(payment.id)) };
    await tx.payment.update({ where: { id: payment.id }, data: { payload: binding } });
    return { config, payment, binding };
  });
  if (claim.config.shopId !== claim.binding.shopId) throw new Error("payment-config-changed");
  if (claim.payment.externalId) return paymentUrl(await refreshYooKassaPayment(claim.payment.externalId));
  if (Date.now() - Date.parse(claim.binding.firstAttemptAt) >= RETRY_MS) {
    await prisma.payment.updateMany({ where: { id: claim.payment.id, externalId: null, status: { in: ["PENDING", "AUTHORIZED"] } }, data: { payload: { ...claim.binding, reconciliationRequired: true } } });
    throw new Error("payment-reconciliation-required");
  }
  const body = JSON.parse(decryptSecret(claim.binding.request, purpose(claim.payment.id)));
  const remote = remoteSchema.parse(await yookassaRequest(claim.config, "payments", { key: claim.payment.id, body }));
  if (remote.metadata.paymentId !== claim.payment.id || remote.metadata.orderId !== orderId || remote.recipient.account_id !== claim.binding.shopId) throw new Error("payment-mismatch");
  await applyYooKassaPayment(remote);
  return paymentUrl(remote);
}

export async function reconcileYooKassaPayments() {
  const payments = await prisma.payment.findMany({ where: { provider: "yookassa-online", OR: [{ status: { in: ["PENDING", "AUTHORIZED"] }, payload: { path: ["version"], equals: 1 } }, { status: "PAID", externalId: { not: null } }] }, orderBy: { updatedAt: "asc" }, take: 8 });
  for (const payment of payments) {
    try {
      if (payment.externalId) await refreshYooKassaPayment(payment.externalId);
      else if (payment.payload) await createYooKassaPayment(payment.orderId);
    } catch { /* Reconcile on a later pass; never invent a successful payment. */ }
    finally { await prisma.payment.updateMany({ where: { id: payment.id }, data: { updatedAt: new Date() } }); }
  }
}
