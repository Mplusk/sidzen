"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { consentDocument, operatorReady, privacySubject } from "@/lib/privacy";
import { purchasedProductWhere, parseReview, REVIEW_CONSENT_TEXT, REVIEW_CONSENT_VERSION } from "@/lib/reviews";
import { reviewPhotoFiles, storeReviewPhotos, removeReviewPhotos } from "@/lib/review-images";

function refreshReviews() {
  revalidatePath("/catalog", "layout"); revalidatePath("/about/");
  revalidatePath("/account/reviews/"); revalidatePath("/account/review-moderation/");
}
export async function createReviewAction(form: FormData) {
  const user = await requireUser("/account/reviews/");
  const parsed = parseReview(form);
  if (!parsed.success) redirect("/account/reviews/?error=invalid");
  if (!await operatorReady()) redirect("/account/reviews/?error=privacy");
  if (!rateLimit(`review-create:${user.id}`, 20, 3600000).allowed) redirect("/account/reviews/?error=rate");
  const input = parsed.data;
  const purchase = await prisma.order.findFirst({ where: purchasedProductWhere(user.id, input.productId), select: { id: true } });
  if (!purchase) redirect("/account/reviews/?error=purchase");
  if (await prisma.review.findFirst({ where: { userId: user.id, productId: input.productId }, select: { id: true } })) redirect("/account/reviews/?error=duplicate");
  let images: Awaited<ReturnType<typeof storeReviewPhotos>>;
  try { images = await storeReviewPhotos(reviewPhotoFiles(form)); }
  catch { redirect("/account/reviews/?error=images"); }
  let failure = "";
  try {
    const document = { ...await consentDocument("account"), purpose: "review", version: REVIEW_CONSENT_VERSION, text: REVIEW_CONSENT_TEXT, url: "https://3dprinta.shop/legal/consent/?purpose=review" };
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412032)`;
      if (!await tx.order.findFirst({ where: purchasedProductWhere(user.id, input.productId), select: { id: true } })) throw new Error("purchase");
      if (await tx.review.findFirst({ where: { userId: user.id, productId: input.productId }, select: { id: true } })) throw new Error("duplicate");
      const consent = await tx.privacyConsent.create({ data: { userId: user.id, purpose: "review", subjectHash: privacySubject(user.id), version: REVIEW_CONSENT_VERSION, document } });
      await tx.review.create({ data: { productId: input.productId, userId: user.id, buyerKey: `${user.id}:${input.productId}`, author: input.author, text: input.text, rating: input.rating, verifiedPurchase: true, consentId: consent.id, images: { create: images } } });
    });
  } catch (error) {
    await removeReviewPhotos(images.map(image => image.fileName));
    failure = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" ? "duplicate" : error instanceof Error && ["purchase", "duplicate"].includes(error.message) ? error.message : "save";
  }
  if (failure) redirect(`/account/reviews/?error=${failure}`);
  refreshReviews(); redirect("/account/reviews/?sent=1");
}

export async function deleteOwnReviewAction(form: FormData) {
  const user = await requireUser("/account/reviews/");
  const id = String(form.get("reviewId") ?? "").slice(0, 100);
  if (form.get("confirmation") !== "delete-review") redirect("/account/reviews/?error=confirmation");
  const deleted = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412032)`;
    const review = await tx.review.findFirst({ where: { id, userId: user.id }, include: { images: true } });
    if (!review) return null;
    if (review.consentId) await tx.privacyConsent.update({ where: { id: review.consentId }, data: { revokedAt: new Date() } });
    await tx.review.delete({ where: { id: review.id } });
    return review.images;
  });
  if (!deleted) redirect("/account/reviews/?error=missing");
  await removeReviewPhotos(deleted.map(image => image.fileName));
  refreshReviews(); redirect("/account/reviews/?deleted=1");
}

export async function moderateReviewAction(form: FormData) {
  const user = await requirePermission("content.write");
  const id = String(form.get("reviewId") ?? "").slice(0, 100), decision = form.get("decision");
  if (!["PUBLISHED", "HIDDEN"].includes(String(decision))) redirect("/account/review-moderation/?error=invalid");
  const result = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412032)`;
    const row = await tx.review.findUnique({ where: { id }, include: { consent: true } });
    if (!row || (decision === "PUBLISHED" && row.verifiedPurchase && (!row.consent || row.consent.revokedAt))) return false;
    await tx.review.update({ where: { id }, data: { status: String(decision), approved: decision === "PUBLISHED" } });
    await tx.auditLog.create({ data: { actorId: user.id, action: "review.moderate", entityType: "Review", entityId: id, before: { status: row.status }, after: { status: String(decision) } } });
    return true;
  });
  refreshReviews(); redirect(`/account/review-moderation/?${result ? "saved=1" : "error=consent"}`);
}
