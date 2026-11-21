import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { writeDiagnostic } from "@/lib/diagnostics";
import { getTelegramConfig } from "./config";
import { sendTelegram, telegramOrderText, telegramPrivateOrderText, telegramOrderStatusText, telegramChatType, TelegramError } from "./client";
import { queueTelegramCancellation } from "./status";
import { telegramFetch } from "./transport";
export async function processTelegramOrder(transport: typeof fetch = telegramFetch) {
  const job = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412041)`;
    // A crash during sending has an unknown outcome: do not resend blindly.
    await tx.telegramOrderJob.updateMany({ where: { status: "RUNNING", leaseUntil: { lte: new Date() } }, data: { status: "UNCERTAIN", errorCode: "uncertain", leaseToken: null, leaseUntil: null } });
    const row = await tx.telegramOrderJob.findFirst({ where: { status: "PENDING", availableAt: { lte: new Date() } }, orderBy: { availableAt: "asc" } });
    if (!row) return null;
    return tx.telegramOrderJob.update({ where: { orderId: row.orderId }, data: { status: "RUNNING", attempts: { increment: 1 }, leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 60000) } });
  });
  if (!job) return;
  const where = { orderId: job.orderId, status: "RUNNING", leaseToken: job.leaseToken };
  try {
    const config = await getTelegramConfig();
    const order = await prisma.order.findUnique({ where: { id: job.orderId }, select: { id: true, number: true, status: true, deletedAt: true, personalDataErasedAt: true, shippingAddress: true, subtotal: true, deliveryPrice: true, total: true, shipment: { select: { provider: true, cost: true, payload: true } }, items: { select: { productName: true, groupLabel: true, productColor: true, configuration: true, quantity: true, totalPrice: true, color: { select: { name: true } }, product: { select: { groupId: true, groupLabel: true, specifications: true } } } } } });
    if (!order || order.deletedAt || order.personalDataErasedAt || !config.enabled || config.revision !== job.revision) {
      await prisma.telegramOrderJob.updateMany({ where, data: { status: "CANCELED", leaseToken: null, leaseUntil: null } }); return;
    }
    if (order.status === "CANCELED") {
      await prisma.$transaction(async tx => {
        await queueTelegramCancellation(tx, order.id);
        await tx.telegramOrderJob.updateMany({ where, data: { status: "CANCELED", leaseToken: null, leaseUntil: null } });
      });
      return;
    }
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://sidzen.shop";
    const chatType = await telegramChatType(config, transport);
    await sendTelegram(config, chatType === "private" ? telegramPrivateOrderText(order, baseUrl) : telegramOrderText(order.id, baseUrl), transport);
    await prisma.telegramOrderJob.updateMany({ where, data: { status: "SENT", sentAt: new Date(), errorCode: null, leaseToken: null, leaseUntil: null } });
    await writeDiagnostic("telegram.sent");
  } catch (error) {
    const safe = error instanceof TelegramError ? error : new TelegramError("response");
    const retry = safe.retryable && job.attempts < 5;
    await prisma.telegramOrderJob.updateMany({ where, data: { status: retry ? "PENDING" : safe.code === "uncertain" ? "UNCERTAIN" : "FAILED", errorCode: safe.code, leaseToken: null, leaseUntil: null, availableAt: new Date(Date.now() + safe.delay * job.attempts) } });
    await writeDiagnostic("telegram.failed", { reason: safe.code === "uncertain" ? "uncertain-submission" : safe.code });
  }
}

/** Separate durable status messages follow any in-flight new-order message. */
export async function processTelegramStatus(transport: typeof fetch = telegramFetch) {
  const job = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412041)`;
    await tx.telegramOrderStatusJob.updateMany({ where: { status: "RUNNING", leaseUntil: { lte: new Date() } }, data: { status: "UNCERTAIN", errorCode: "uncertain", leaseToken: null, leaseUntil: null } });
    const row = await tx.telegramOrderStatusJob.findFirst({ where: { status: "PENDING", availableAt: { lte: new Date() } }, orderBy: { availableAt: "asc" } });
    if (!row) return null;
    const original = await tx.telegramOrderJob.findUnique({ where: { orderId: row.orderId }, select: { status: true } });
    const canceled = row.kind === "LATE_PAYMENT" ? await tx.telegramOrderStatusJob.findUnique({ where: { orderId_kind: { orderId: row.orderId, kind: "CANCELED" } }, select: { status: true } }) : null;
    if ((original && ["PENDING", "RUNNING"].includes(original.status)) || (canceled && ["PENDING", "RUNNING"].includes(canceled.status))) {
      await tx.telegramOrderStatusJob.update({ where: { id: row.id }, data: { availableAt: new Date(Date.now() + 2000) } });
      return null;
    }
    return tx.telegramOrderStatusJob.update({ where: { id: row.id }, data: { status: "RUNNING", attempts: { increment: 1 }, leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 60000) } });
  });
  if (!job) return;
  const where = { id: job.id, status: "RUNNING", leaseToken: job.leaseToken };
  try {
    const [config, order] = await Promise.all([
      getTelegramConfig(),
      prisma.order.findUnique({ where: { id: job.orderId }, select: { id: true, number: true, status: true, deletedAt: true, personalDataErasedAt: true, reservationExpiredAt: true, stockReviewRequired: true, payment: { select: { status: true } } } }),
    ]);
    const validKind = job.kind === "CANCELED" || job.kind === "LATE_PAYMENT";
    const current = job.kind === "CANCELED" ? order?.status === "CANCELED" : order?.payment?.status === "PAID" && !["CANCELED", "REFUNDED"].includes(order.status);
    if (!order || order.deletedAt || order.personalDataErasedAt || !config.enabled || config.revision !== job.revision || !validKind || !current) {
      await prisma.telegramOrderStatusJob.updateMany({ where, data: { status: "CANCELED", leaseToken: null, leaseUntil: null } }); return;
    }
    const chatType = await telegramChatType(config, transport);
    await sendTelegram(config, telegramOrderStatusText(order, job.kind as "CANCELED" | "LATE_PAYMENT", process.env.NEXT_PUBLIC_SITE_URL || "https://sidzen.shop", chatType === "private"), transport);
    await prisma.telegramOrderStatusJob.updateMany({ where, data: { status: "SENT", sentAt: new Date(), errorCode: null, leaseToken: null, leaseUntil: null } });
    await writeDiagnostic("telegram.sent");
  } catch (error) {
    const safe = error instanceof TelegramError ? error : new TelegramError("response");
    const retry = safe.retryable && job.attempts < 5;
    await prisma.telegramOrderStatusJob.updateMany({ where, data: { status: retry ? "PENDING" : safe.code === "uncertain" ? "UNCERTAIN" : "FAILED", errorCode: safe.code, leaseToken: null, leaseUntil: null, availableAt: new Date(Date.now() + safe.delay * job.attempts) } });
    await writeDiagnostic("telegram.failed", { reason: safe.code === "uncertain" ? "uncertain-submission" : safe.code });
  }
}
