"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser, requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { rfStorageReady } from "@/lib/privacy";

export async function requestPersonalData(form: FormData) {
  const user = await requireUser("/account/privacy/");
  if (!rfStorageReady()) redirect("/account/privacy/?error=localization");
  if (!rateLimit(`privacy-request:${user.id}`, 5, 3600000).allowed) redirect("/account/privacy/?error=rate");
  const parsed = z.object({ type: z.enum(["ACCESS", "CORRECT", "DELETE", "WITHDRAW"]), message: z.string().trim().min(5).max(2000) }).safeParse({ type: form.get("type"), message: form.get("message") });
  if (!parsed.success) redirect("/account/privacy/?error=invalid");
  await prisma.$transaction(async tx => {
    await tx.privacyRequest.create({ data: { userId: user.id, ...parsed.data } });
    // Stop existing pre-order permissions immediately. Account/order retention is
    // reviewed by the operator; do not silently erase contracts or staff accounts.
    if (parsed.data.type === "WITHDRAW") await tx.privacyConsent.updateMany({ where: { userId: user.id, purpose: "ozon", revokedAt: null }, data: { revokedAt: new Date() } });
  });
  revalidatePath("/account/privacy/"); redirect("/account/privacy/?sent=1");
}

export async function answerPersonalDataRequest(form: FormData) {
  const actor = await requirePermission("users.write");
  if (!rfStorageReady()) redirect("/admin/privacy/?error=localization");
  const parsed = z.object({ id: z.string().min(1).max(100), status: z.enum(["IN_PROGRESS", "RESOLVED"]), response: z.string().trim().min(5).max(2000) }).safeParse({ id: form.get("id"), status: form.get("status"), response: form.get("response") });
  if (!parsed.success) redirect("/admin/privacy/?error=invalid");
  await prisma.$transaction(async tx => {
    await tx.privacyRequest.update({ where: { id: parsed.data.id }, data: { status: parsed.data.status, response: parsed.data.response } });
    await tx.auditLog.create({ data: { actorId: actor.id, action: "privacy.request.respond", entityType: "PrivacyRequest", entityId: parsed.data.id, after: { status: parsed.data.status } } });
  });
  revalidatePath("/admin/privacy/"); revalidatePath("/account/privacy/");
}
