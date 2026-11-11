import type { Prisma } from "@prisma/client";

/** Queue a cancellation only for orders that had Telegram enabled at creation. */
export async function queueTelegramCancellation(tx: Prisma.TransactionClient, orderId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412041)`;
  const original = await tx.telegramOrderJob.findUnique({ where: { orderId }, select: { revision: true } });
  if (!original?.revision) return;
  // An unsent new-order notice is obsolete; a running one must finish first.
  await tx.telegramOrderJob.updateMany({ where: { orderId, status: "PENDING" }, data: { status: "CANCELED", errorCode: null } });
  await tx.telegramOrderStatusJob.upsert({ where: { orderId_kind: { orderId, kind: "CANCELED" } }, create: { orderId, kind: "CANCELED", revision: original.revision }, update: {} });
}

/** Correct a cancellation notice if a verified payment arrives afterwards. */
export async function queueTelegramLatePayment(tx: Prisma.TransactionClient, orderId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412041)`;
  const canceled = await tx.telegramOrderStatusJob.findUnique({ where: { orderId_kind: { orderId, kind: "CANCELED" } } });
  if (!canceled) return;
  if (canceled.status === "PENDING") {
    await tx.telegramOrderStatusJob.updateMany({ where: { id: canceled.id, status: "PENDING" }, data: { status: "CANCELED" } });
  } else if (!["RUNNING", "SENT", "UNCERTAIN"].includes(canceled.status)) return;
  await tx.telegramOrderStatusJob.upsert({ where: { orderId_kind: { orderId, kind: "LATE_PAYMENT" } }, create: { orderId, kind: "LATE_PAYMENT", revision: canceled.revision }, update: {} });
}
