import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { encryptSecret, decryptSecret } from "@/lib/integration-secrets";
import { cloudReady, RECEIPT_PURPOSE, type CloudConfig } from "./config";
import { createFiscalPayload, derivedFiscalPayload, fiscalPayloadSchema } from "./payload";

export async function prepareFiscalReceipt(tx: Prisma.TransactionClient, orderId: string, config: CloudConfig) {
  if (!cloudReady(config)) throw new Error("cloud-not-ready");
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
  const id = randomUUID();
  const payload = createFiscalPayload(order, config.inn, id);
  await tx.fiscalReceipt.create({ data: { id, orderId, kind: "PREPAYMENT", publicId: config.publicId, inn: config.inn, amount: order.total, request: encryptSecret(JSON.stringify(payload), `${RECEIPT_PURPOSE}:${id}`) } });
  return id;
}
export function readFiscalPayload(receipt: { id: string; request: string }) {
  return fiscalPayloadSchema.parse(JSON.parse(decryptSecret(receipt.request, `${RECEIPT_PURPOSE}:${receipt.id}`)));
}
export async function queueDerivedReceipt(tx: Prisma.TransactionClient, orderId: string, kind: "SETTLEMENT" | "REFUND") {
  const original = await tx.fiscalReceipt.findUnique({ where: { orderId_kind: { orderId, kind: "PREPAYMENT" } } });
  if (!original) return; // No retrospective fiscalization of unrelated historical orders.
  const existing = await tx.fiscalReceipt.findUnique({ where: { orderId_kind: { orderId, kind } } });
  if (existing) return;
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { payment: true } });
  if (kind === "SETTLEMENT" && (order.payment?.status !== "PAID" || order.payment.refundReviewRequired)) throw new Error("fiscal-unpaid");
  if (kind === "REFUND" && order.payment?.status !== "REFUNDED") throw new Error("fiscal-refund-unverified");
  const settlement = await tx.fiscalReceipt.findUnique({ where: { orderId_kind: { orderId, kind: "SETTLEMENT" } } });
  const id = randomUUID();
  const payload = derivedFiscalPayload(readFiscalPayload(original), kind, id, Boolean(settlement));
  await tx.fiscalReceipt.create({ data: { id, orderId, kind, status: "PENDING", publicId: original.publicId, inn: original.inn, amount: original.amount, request: encryptSecret(JSON.stringify(payload), `${RECEIPT_PURPOSE}:${id}`) } });
}
