import type { Prisma } from "@prisma/client";
export function fiscalAttentionWhere(now = new Date()): Prisma.OrderWhereInput {
  return { OR: [
    { payment: { refundReviewRequired: true } },
    { fiscalReceipts: { some: { status: "MANUAL_REVIEW" } } },
    { fiscalReceipts: { some: { status: { in: ["PENDING", "SENDING", "QUEUED"] }, createdAt: { lt: new Date(now.getTime() - 5 * 60_000) } } } },
    { yookassaSettlement: { is: { status: "MANUAL_REVIEW" } } },
    { yookassaSettlement: { is: { status: { in: ["PENDING", "SENDING", "QUEUED"] }, createdAt: { lt: new Date(now.getTime() - 5 * 60_000) } } } },
    { payment: { is: { provider: "yookassa-online", payload: { path: ["receiptStatus"], equals: "canceled" } } } },
    { payment: { is: { provider: "yookassa-online", payload: { path: ["reconciliationRequired"], equals: true } } } },
    { payment: { is: { provider: "yookassa-online", status: "PAID", paidAt: { lt: new Date(now.getTime() - 3 * 86400_000) }, NOT: { payload: { path: ["receiptStatus"], equals: "succeeded" } } } } },
  ] };
}
