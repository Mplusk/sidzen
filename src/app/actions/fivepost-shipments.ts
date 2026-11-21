"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";

export async function reconcileFivePost(form: FormData) {
  const user = await requirePermission("orders.write");
  if (!rateLimit(`fivepost-review:${user.id}`, 10, 60000).allowed) return;
  const jobId = String(form.get("jobId") ?? ""), number = String(form.get("number") ?? "");
  const retry = form.get("intent") === "retry";
  if (!jobId || jobId.length > 80 || !number || number.length > 80 || (retry && form.get("absent") !== "on")) return;
  await prisma.$transaction(async tx => {
    const job = await tx.fivePostDeliveryJob.findFirst({ where: { id: jobId, status: "REVIEW", shipment: { order: { number } } } });
    if (!job || (retry && (job.remoteId || job.cancelRequestedAt))) return;
    const result = await tx.fivePostDeliveryJob.updateMany({ where: { id: job.id, status: "REVIEW", lockToken: null, ...(retry ? { remoteId: null, cancelRequestedAt: null, shipment: { order: { deletedAt: null, status: { notIn: ["CANCELED", "REFUNDED"] }, payment: { is: { status: "PAID" } } } } } : {}) },
      data: { status: retry ? "PENDING" : "SENDING", error: null, nextAttemptAt: retry ? new Date() : new Date(Math.max(Date.now(), job.nextAttemptAt.getTime())) } });
    if (result.count) await tx.auditLog.create({ data: { actorId: user.id, action: retry ? "delivery.fivepost.retry" : "delivery.fivepost.reconcile", entityType: "Shipment", entityId: job.shipmentId } });
  });
  revalidatePath(`/admin/orders/${number}/`);
}
