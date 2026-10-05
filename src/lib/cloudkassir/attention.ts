import type { Prisma } from "@prisma/client";
export function fiscalAttentionWhere(now = new Date()): Prisma.OrderWhereInput {
  return { OR: [
    { payment: { refundReviewRequired: true } },
    { fiscalReceipts: { some: { status: "MANUAL_REVIEW" } } },
    { fiscalReceipts: { some: { status: { in: ["PENDING", "SENDING", "QUEUED"] }, createdAt: { lt: new Date(now.getTime() - 5 * 60_000) } } } },
  ] };
}
