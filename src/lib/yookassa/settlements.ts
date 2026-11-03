import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/integration-secrets";
import { operatorReady } from "@/lib/privacy";
import { getYooKassaConfig } from "./config";
import { settlementForOrder } from "./receipt";
import { yookassaRequest } from "./payments";

const bindingSchema = z.object({ shopId: z.string(), receiptStatus: z.string().optional() });
const resultSchema = z.object({ id: z.string().min(1).max(150), payment_id: z.string().uuid(), type: z.literal("payment"), status: z.enum(["pending", "succeeded", "canceled"]) });
const purpose = (id: string) => `yookassa.settlement:${id}`;
const RETRY_MS = 23 * 60 * 60 * 1000;

export async function queueYooKassaSettlement(tx: Prisma.TransactionClient, orderId: string) {
  const existing = await tx.yooKassaSettlement.findUnique({ where: { orderId } });
  if (existing) return;
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true, payment: true } });
  const payment = order.payment;
  if (!payment || payment.provider !== "yookassa-online" || payment.status !== "PAID" || payment.refundReviewRequired || !payment.externalId) throw new Error("fiscal-unpaid");
  const binding = bindingSchema.parse(payment.payload);
  const id = randomUUID();
  const body = settlementForOrder(order, payment.externalId);
  await tx.yooKassaSettlement.create({ data: { id, orderId, paymentId: payment.externalId, shopId: binding.shopId, request: encryptSecret(JSON.stringify(body), purpose(id)) } });
}

export async function processYooKassaSettlement(now = new Date()) {
  if (!await operatorReady()) return false;
  const claim = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412026)`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412034)`;
    const row = await tx.yooKassaSettlement.findFirst({ where: { status: { in: ["PENDING", "SENDING", "QUEUED"] }, nextAttemptAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }, include: { order: { include: { payment: true } } }, orderBy: { nextAttemptAt: "asc" } });
    if (!row) return null;
    const config = await getYooKassaConfig(tx);
    const payment = row.order.payment;
    if (!payment || payment.provider !== "yookassa-online" || payment.status !== "PAID" || payment.refundReviewRequired || payment.externalId !== row.paymentId) {
      await tx.yooKassaSettlement.update({ where: { id: row.id }, data: { status: "MANUAL_REVIEW", errorCode: "payment-status", leaseUntil: null } }); return null;
    }
    const binding = bindingSchema.parse(payment.payload);
    if (config.shopId !== row.shopId || !config.secret || binding.shopId !== row.shopId) {
      await tx.yooKassaSettlement.update({ where: { id: row.id }, data: { errorCode: "configuration", nextAttemptAt: new Date(now.getTime() + 60000) } }); return null;
    }
    if (binding.receiptStatus !== "succeeded") {
      await tx.yooKassaSettlement.update({ where: { id: row.id }, data: binding.receiptStatus === "canceled" ? { status: "MANUAL_REVIEW", errorCode: "prepayment-receipt" } : { errorCode: "prepayment-receipt", nextAttemptAt: new Date(now.getTime() + 60000) } }); return null;
    }
    if (!row.externalId && row.firstAttemptAt && now.getTime() - row.firstAttemptAt.getTime() >= RETRY_MS) {
      await tx.yooKassaSettlement.update({ where: { id: row.id }, data: { status: "MANUAL_REVIEW", errorCode: "uncertain-submission", leaseUntil: null } }); return null;
    }
    const receipt = await tx.yooKassaSettlement.update({ where: { id: row.id }, data: { status: row.externalId ? "QUEUED" : "SENDING", firstAttemptAt: row.firstAttemptAt ?? now, attempts: { increment: 1 }, leaseUntil: new Date(now.getTime() + 60000), nextAttemptAt: new Date(now.getTime() + 30000) } });
    return { receipt, config };
  });
  if (!claim) return false;
  const { receipt, config } = claim;
  try {
    const result = resultSchema.parse(receipt.externalId
      ? await yookassaRequest(config, `receipts/${encodeURIComponent(receipt.externalId)}`)
      : await yookassaRequest(config, "receipts", { key: receipt.id, body: JSON.parse(decryptSecret(receipt.request, purpose(receipt.id))) }));
    if (result.payment_id !== receipt.paymentId || (receipt.externalId && receipt.externalId !== result.id)) throw new Error("receipt-mismatch");
    await prisma.yooKassaSettlement.updateMany({ where: { id: receipt.id, status: { in: ["SENDING", "QUEUED"] } }, data: { externalId: result.id, status: result.status === "succeeded" ? "PROCESSED" : result.status === "canceled" ? "MANUAL_REVIEW" : "QUEUED", processedAt: result.status === "succeeded" ? now : undefined, errorCode: result.status === "canceled" ? "provider-rejected" : null, leaseUntil: null } });
  } catch {
    await prisma.yooKassaSettlement.updateMany({ where: { id: receipt.id, status: { in: ["SENDING", "QUEUED"] } }, data: { errorCode: "temporary", leaseUntil: null, nextAttemptAt: new Date(now.getTime() + 30000) } });
  }
  return true;
}
