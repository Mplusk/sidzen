import { createHash, randomUUID } from "node:crypto";
import type { Prisma, ReviewAiJob } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getCategoryAiConfig } from "@/lib/category-ai/config";
import { purchasedProductWhere } from "@/lib/reviews";
import { writeDiagnostic } from "@/lib/diagnostics";
import { getReviewAiConfig, reviewTransferApproved } from "./config";
import { checkReviewText, ReviewAiError } from "./client";
import { REVIEW_AI_CONSENT_VERSIONS, reviewTextGate } from "./policy";
const lock = async (tx: Prisma.TransactionClient) => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412032)`; };
const signature = (row: { author: string; text: string; rating: number; product: { name: string; shortDescription: string | null } }) => createHash("sha256").update(JSON.stringify([row.author, row.text, row.rating, row.product.name, row.product.shortDescription])).digest("hex");
export async function claimReviewAiJob() {
  return prisma.$transaction(async tx => {
    await lock(tx);
    const now = new Date();
    const job = await tx.reviewAiJob.findFirst({ where: { OR: [{ status: "PENDING", availableAt: { lte: now } }, { status: "RUNNING", leaseUntil: { lte: now } }] }, orderBy: { availableAt: "asc" } });
    if (!job) return null;
    if (job.attempts >= 3) { await tx.reviewAiJob.update({ where: { reviewId: job.reviewId }, data: { status: "MANUAL", reason: "unavailable", leaseToken: null, leaseUntil: null } }); return null; }
    return tx.reviewAiJob.update({ where: { reviewId: job.reviewId }, data: { status: "RUNNING", attempts: { increment: 1 }, leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 120000) } });
  });
}
function validAiConsent(row: { purpose: string; version: string; revokedAt: Date | null; userId: string | null } | null, userId: string | null) {
  return Boolean(row && row.purpose === "review-ai" && REVIEW_AI_CONSENT_VERSIONS.includes(row.version) && !row.revokedAt && row.userId === userId);
}
const reviewInclude = { consent: true, product: { select: { name: true, shortDescription: true } }, images: { select: { id: true } } } as const;
export async function finishReviewAiJob(job: ReviewAiJob, reason: string, fingerprint: string, revision: string) {
  return prisma.$transaction(async tx => {
    await lock(tx);
    const current = await tx.reviewAiJob.findUnique({ where: { reviewId: job.reviewId }, include: { consent: true } });
    if (!current || current.status !== "RUNNING" || current.leaseToken !== job.leaseToken || !current.leaseUntil || current.leaseUntil <= new Date()) return false;
    const review = await tx.review.findUnique({ where: { id: job.reviewId }, include: reviewInclude });
    const config = await getReviewAiConfig(tx);
    let outcome = reason;
    if (!review || review.status !== "PENDING" || review.approved) outcome = "changed";
    else if (signature(review) !== fingerprint || config.revision !== revision) outcome = "changed";
    else if (!review.consent || review.consent.revokedAt || !validAiConsent(current.consent, review.userId)) outcome = "consent";
    else if (!reviewTransferApproved()) outcome = "legal";
    else if (!config.enabled || !config.operatorReviewed) outcome = "disabled";
    else if (review.images.length) outcome = "photos";
    else if (!review.userId || !await tx.order.findFirst({ where: purchasedProductWhere(review.userId, review.productId), select: { id: true } })) outcome = "changed";
    const approved = outcome === "approved";
    if (approved) {
      await tx.review.update({ where: { id: job.reviewId }, data: { approved: true, status: "PUBLISHED" } });
      await tx.auditLog.create({ data: { action: "review.ai.publish", entityType: "Review", entityId: job.reviewId, after: { status: "PUBLISHED" } } });
    }
    await tx.reviewAiJob.update({ where: { reviewId: job.reviewId }, data: { status: approved ? "APPROVED" : "MANUAL", reason: outcome, leaseToken: null, leaseUntil: null } });
    return approved;
  });
}
export async function processReviewAiJob(transport: typeof fetch = fetch) {
  const job = await claimReviewAiJob(); if (!job) return false;
  try {
    const row = await prisma.review.findUnique({ where: { id: job.reviewId }, include: reviewInclude });
    if (!row) return false; // FK cascade removed the job too.
    const settings = await getReviewAiConfig();
    const consent = job.consentId ? await prisma.privacyConsent.findUnique({ where: { id: job.consentId } }) : null;
    let reason = row.status !== "PENDING" || row.approved ? "changed" : !validAiConsent(consent, row.userId) || !row.consent || row.consent.revokedAt ? "consent" : reviewTextGate(row.text);
    if (!reason) reason = reviewTextGate(row.author);
    if (!reason && !reviewTransferApproved()) reason = "legal";
    if (!reason && row.images.length) reason = "photos";
    if (!reason && (!settings.enabled || !settings.operatorReviewed)) reason = "disabled";
    if (!reason) {
      const config = await getCategoryAiConfig();
      reason = !config.apiKey || !config.checkedAt ? "disabled" : await checkReviewText(config, row.product, row.text, row.rating, transport);
    }
    const changed = await finishReviewAiJob(job, reason!, signature(row), settings.revision);
    await writeDiagnostic(changed ? "review-ai.approved" : "review-ai.manual");
    return changed;
  } catch (error) {
    const retry = error instanceof ReviewAiError && error.retryable && job.attempts < 3;
    await prisma.reviewAiJob.updateMany({ where: { reviewId: job.reviewId, status: "RUNNING", leaseToken: job.leaseToken }, data: { status: retry ? "PENDING" : "MANUAL", reason: retry ? "queued" : "unavailable", availableAt: new Date(Date.now() + job.attempts * 30000), leaseToken: null, leaseUntil: null } });
    await writeDiagnostic("review-ai.manual"); return false;
  }
}
