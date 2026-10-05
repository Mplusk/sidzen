import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { operatorReady } from "@/lib/privacy";
import { cloudConfigured, getCloudConfig } from "./config";
import { cloudRequest, safeReceiptUrl } from "./client";
import { readFiscalPayload } from "./lifecycle";
import { writeDiagnostic } from "@/lib/diagnostics";

// The provider retains idempotency results for ONE HOUR. Never blindly resend
// an unknown submission after that window, even after a crash or manual retry.
export const SAFE_RETRY_MS = 45 * 60_000;
export async function processFiscalReceipt(now = new Date()) {
  if (!await operatorReady()) return false;
  const claim = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412026)`;
    const row = await tx.fiscalReceipt.findFirst({ where: { status: { in: ["PENDING", "SENDING", "QUEUED"] }, nextAttemptAt: { lte: now }, OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }] }, orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }] });
    if (!row) return null;
    const config = await getCloudConfig(tx);
    if (!cloudConfigured(config) || config.publicId !== row.publicId || config.inn !== row.inn) {
      await tx.fiscalReceipt.update({ where: { id: row.id }, data: { errorCode: "configuration", nextAttemptAt: new Date(now.getTime() + 60_000) } }); return null;
    }
    if (!row.externalId && row.firstAttemptAt && now.getTime() - row.firstAttemptAt.getTime() >= SAFE_RETRY_MS) {
      await tx.fiscalReceipt.update({ where: { id: row.id }, data: { status: "MANUAL_REVIEW", errorCode: "uncertain-submission", leaseUntil: null } }); return null;
    }
    if (row.kind !== "PREPAYMENT") {
      const prior = await tx.fiscalReceipt.findMany({ where: { orderId: row.orderId, kind: { in: row.kind === "REFUND" ? ["PREPAYMENT", "SETTLEMENT"] : ["PREPAYMENT"] } } });
      if (prior.some(item => item.status !== "PROCESSED")) {
        await tx.fiscalReceipt.update({ where: { id: row.id }, data: { errorCode: "previous-receipt", nextAttemptAt: new Date(now.getTime() + 60_000) } }); return null;
      }
    }
    const receipt = await tx.fiscalReceipt.update({ where: { id: row.id }, data: { status: row.externalId ? "QUEUED" : "SENDING", firstAttemptAt: row.firstAttemptAt ?? now, attempts: { increment: 1 }, leaseUntil: new Date(now.getTime() + 60_000), nextAttemptAt: new Date(now.getTime() + 30_000) } });
    return { receipt, config };
  });
  if (!claim) return false;
  const { receipt, config } = claim;
  try {
    if (!receipt.externalId) {
      const body = readFiscalPayload(receipt);
      const result = z.object({ Id: z.string().min(1).max(100), ReceiptLocalUrl: z.string().optional().nullable() }).parse(await cloudRequest(config, "kkt/receipt", body, receipt.requestId));
      await prisma.fiscalReceipt.updateMany({ where: { id: receipt.id, status: { not: "PROCESSED" }, OR: [{ externalId: null }, { externalId: result.Id }] }, data: { externalId: result.Id, status: "QUEUED", receiptUrl: safeReceiptUrl(result.ReceiptLocalUrl), leaseUntil: null, errorCode: null } });
    } else {
      const state = z.enum(["Processed", "Queued", "Error", "NotFound"]).parse(await cloudRequest(config, "kkt/receipt/status/get", { Id: receipt.externalId }));
      await prisma.fiscalReceipt.updateMany({ where: { id: receipt.id, status: { not: "PROCESSED" } }, data: { status: state === "Processed" ? "PROCESSED" : state === "Queued" ? "QUEUED" : "MANUAL_REVIEW", processedAt: state === "Processed" ? now : undefined, leaseUntil: null, errorCode: state === "Error" || state === "NotFound" ? "provider-status" : null } });
      if (state === "Error" || state === "NotFound") await writeDiagnostic("fiscal.review", { reason: "provider-status", attempts: receipt.attempts });
    }
  } catch (error) {
    const rejected = error instanceof Error && error.message === "cloud-rejected";
    await writeDiagnostic("fiscal.failed", { reason: rejected ? "provider-rejected" : "temporary", attempts: receipt.attempts });
    await prisma.fiscalReceipt.updateMany({ where: { id: receipt.id, status: { not: "PROCESSED" } }, data: { status: rejected ? "MANUAL_REVIEW" : receipt.externalId ? "QUEUED" : "SENDING", leaseUntil: null, errorCode: rejected ? "provider-rejected" : "temporary", nextAttemptAt: new Date(now.getTime() + 30_000) } });
  }
  return true;
}
