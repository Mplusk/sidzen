import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { writeDiagnostic } from "@/lib/diagnostics";
import { getTelegramConfig } from "./config";
import { sendTelegram, telegramOrderText, telegramPrivateOrderText, telegramChatType, TelegramError } from "./client";
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
    const order = await prisma.order.findUnique({ where: { id: job.orderId }, select: { id: true, number: true, deletedAt: true, personalDataErasedAt: true, shippingAddress: true, subtotal: true, deliveryPrice: true, total: true, shipment: { select: { provider: true, cost: true } }, items: { select: { productName: true, quantity: true, totalPrice: true } } } });
    if (!order || order.deletedAt || order.personalDataErasedAt || !config.enabled || config.revision !== job.revision) {
      await prisma.telegramOrderJob.updateMany({ where, data: { status: "CANCELED", leaseToken: null, leaseUntil: null } }); return;
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
