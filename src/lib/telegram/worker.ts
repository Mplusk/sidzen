import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { writeDiagnostic } from "@/lib/diagnostics";
import { getTelegramConfig } from "./config";
import { sendTelegram, telegramOrderText, TelegramError } from "./client";
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
    const order = await prisma.order.findUnique({ where: { id: job.orderId }, select: { deletedAt: true } });
    if (!order || order.deletedAt || !config.enabled || config.revision !== job.revision) {
      await prisma.telegramOrderJob.updateMany({ where, data: { status: "CANCELED", leaseToken: null, leaseUntil: null } }); return;
    }
    await sendTelegram(config, telegramOrderText(job.orderId, process.env.NEXT_PUBLIC_SITE_URL || "https://sidzen.shop"), transport);
    await prisma.telegramOrderJob.updateMany({ where, data: { status: "SENT", sentAt: new Date(), errorCode: null, leaseToken: null, leaseUntil: null } });
    await writeDiagnostic("telegram.sent");
  } catch (error) {
    const safe = error instanceof TelegramError ? error : new TelegramError("response");
    const retry = safe.retryable && job.attempts < 5;
    await prisma.telegramOrderJob.updateMany({ where, data: { status: retry ? "PENDING" : safe.code === "uncertain" ? "UNCERTAIN" : "FAILED", errorCode: safe.code, leaseToken: null, leaseUntil: null, availableAt: new Date(Date.now() + safe.delay * job.attempts) } });
    await writeDiagnostic("telegram.failed", { reason: safe.code === "uncertain" ? "uncertain-submission" : safe.code });
  }
}
