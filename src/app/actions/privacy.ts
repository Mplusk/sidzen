"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rfStorageReady } from "@/lib/privacy";
import { rateLimit } from "@/lib/rate-limit";

export async function setOrderRetentionHold(form: FormData) {
  const actor = await requirePermission("orders.write");
  await requirePermission("customers.write");
  if (!rateLimit(`privacy-hold:${actor.id}`, 15, 60000).allowed) redirect("/admin/orders/?error=rate");
  const input = z.object({ id: z.string().min(1).max(100), until: z.union([z.literal(""), z.iso.date()]), reason: z.enum(["dispute", "authority", "warranty"]) }).safeParse({ id: form.get("orderId"), until: form.get("until"), reason: form.get("reason") });
  if (!input.success || form.get("confirmation") !== "on") redirect("/admin/orders/?error=retention");
  const until = input.data.until ? new Date(`${input.data.until}T23:59:59.999+03:00`) : null;
  if (until && (until <= new Date() || until.getUTCFullYear() > new Date().getUTCFullYear() + 10)) redirect("/admin/orders/?error=retention");
  const number = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412026)`;
    const order = await tx.order.findUnique({ where: { id: input.data.id }, select: { id: true, number: true, personalDataErasedAt: true } });
    if (!order || order.personalDataErasedAt) return null;
    await tx.order.update({ where: { id: order.id }, data: { retentionHoldUntil: until, retentionHoldReason: until ? input.data.reason : null } });
    await tx.auditLog.create({ data: { actorId: actor.id, action: "privacy.retention.hold", entityType: "Order", entityId: order.id, after: { until: until?.toISOString() ?? null, reason: until ? input.data.reason : null } } });
    return order.number;
  });
  revalidatePath("/admin/orders", "layout");
  redirect(number ? `/admin/orders/${encodeURIComponent(number)}/?retention=saved` : "/admin/orders/?error=retention");
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
  revalidatePath("/admin/privacy/");
}
