import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { rfStorageReady } from "./privacy";
import { afterDays, inactiveAccountCutoff, RETENTION, terminalOrderStatuses } from "./privacy-retention-policy";
import { drainErasureFiles, eraseExpiredOrders, eraseInactiveAccount, ErasureError, pruneErasureEvidence } from "./privacy-erasure";

export async function prunePersonalDataRetention(now = new Date()) {
  if (!rfStorageReady()) return;
  await drainErasureFiles();
  // Covers terminal carrier/bank callbacks too. A fixed closure timestamp avoids
  // technical refreshes silently extending the purpose-based retention period.
  await prisma.order.updateMany({ where: { privacyClosedAt: null, OR: [{ deletedAt: { not: null } }, { status: { in: [...terminalOrderStatuses] } }] }, data: { privacyClosedAt: now } });
  const year = Number(new Intl.DateTimeFormat("en", { timeZone: "Europe/Moscow", year: "numeric" }).format(now));
  const financialBefore = new Date(Date.UTC(year - RETENTION.fiscalYears, 0, 1) - 3 * 3600000);
  const where: Prisma.OrderWhereInput = {
    privacyClosedAt: { lte: afterDays(now, -(RETENTION.closedApplicationDays - 1)) },
    AND: [
      { OR: [{ personalDataErasedAt: null }, { customerEmail: { not: "" } }] },
      { OR: [{ retentionHoldUntil: null }, { retentionHoldUntil: { lte: now } }] },
      { OR: [{ status: { in: [...terminalOrderStatuses] } }, { deletedAt: { not: null }, status: { in: ["NEW", "ESTIMATING", "APPROVED", "IN_PROGRESS", "AWAITING_PAYMENT"] } }] },
      { OR: [{ payment: null }, { payment: { is: { status: { notIn: ["PENDING", "AUTHORIZED"] }, refundReviewRequired: false } } }] },
      { fiscalReceipts: { none: { status: { notIn: ["PROCESSED", "CANCELED"] } } } },
      { OR: [{ yookassaSettlement: null }, { yookassaSettlement: { is: { status: { in: ["PROCESSED", "CANCELED"] } } } }] },
      { OR: [
        { status: { notIn: ["DELIVERED", "REFUNDED"] }, purchaseConfirmedAt: null, fiscalReceipts: { none: {} }, OR: [{ payment: null }, { payment: { is: { status: { notIn: ["PAID", "REFUNDED"] } } } }] },
        { privacyClosedAt: { lt: financialBefore }, AND: [
          { OR: [{ purchaseConfirmedAt: null }, { purchaseConfirmedAt: { lt: financialBefore } }] },
          { OR: [{ payment: null }, { payment: { is: { OR: [{ paidAt: null }, { paidAt: { lt: financialBefore } }] } } }] },
          { fiscalReceipts: { none: { OR: [{ processedAt: { gte: financialBefore } }, { processedAt: null, createdAt: { gte: financialBefore } }] } } },
          { OR: [{ yookassaSettlement: null }, { yookassaSettlement: { is: { OR: [{ processedAt: { lt: financialBefore } }, { processedAt: null, createdAt: { lt: financialBefore } }] } } }] },
        ] },
      ] },
    ],
  };
  let cursor: string | undefined;
  for (let batch = 0; batch < 10; batch++) {
    const candidates = await prisma.order.findMany({ where, orderBy: { id: "asc" }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true } });
    for (const order of candidates) {
      try { await eraseExpiredOrders([order.id], now); }
      catch (error) { if (!(error instanceof ErasureError)) throw error; }
    }
    if (candidates.length < 100) break;
    cursor = candidates.at(-1)!.id;
  }
  const cutoff = inactiveAccountCutoff(now);
  const accounts = await prisma.user.findMany({ where: {
    lastActiveAt: { lt: cutoff }, updatedAt: { lt: cutoff },
    roles: { every: { role: { code: "customer" } } }, sessions: { none: { expiresAt: { gt: now } } },
    orders: { none: { deletedAt: null, status: { notIn: [...terminalOrderStatuses] } } },
  }, orderBy: { lastActiveAt: "asc" }, take: 25, select: { id: true } });
  for (const account of accounts) {
    try { await eraseInactiveAccount(account.id, now); }
    catch (error) { if (!(error instanceof ErasureError)) throw error; }
  }
  await pruneErasureEvidence(now);
}
