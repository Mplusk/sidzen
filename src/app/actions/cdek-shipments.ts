"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { getCdekConfig } from "@/lib/delivery/cdek-config";
import { CdekDeliveryClient } from "@/lib/delivery/cdek-client";

export async function reconcileCdekShipment(form: FormData) {
  const user = await requirePermission(PERMISSIONS.ordersWrite);
  const input = z.object({ jobId: z.string().min(1).max(100), number: z.string().min(1).max(100), intent: z.enum(["recheck", "retry", "absent", "attach"]), remoteId: z.string().optional(), confirmed: z.literal("on") }).safeParse({ jobId: form.get("jobId"), number: form.get("number"), intent: form.get("intent"), remoteId: form.get("remoteId") || undefined, confirmed: form.get("confirmed") });
  if (!input.success) redirect("/admin/orders/?error=confirmation");
  let matchedRemoteId: string | undefined;
  if (input.data.intent === "attach") {
    const remoteId = z.uuid().safeParse(input.data.remoteId);
    const snapshot = await prisma.cdekDeliveryJob.findUnique({ where: { id: input.data.jobId }, include: { shipment: { include: { order: true } } } });
    if (!remoteId.success || !snapshot || snapshot.status !== "REVIEW" || snapshot.remoteId || snapshot.shipment.order.number !== input.data.number) redirect("/admin/orders/?error=confirmation");
    try {
      const config = await getCdekConfig();
      if (config.clientId !== snapshot.clientId || config.environment !== snapshot.environment) throw new Error("config");
      const expected = z.object({ delivery_point: z.string(), packages: z.array(z.object({ number: z.string() })).min(1) }).parse(snapshot.request);
      const actual = z.object({ entity: z.object({ delivery_point: z.string(), packages: z.array(z.object({ number: z.string() })) }) }).parse(await new CdekDeliveryClient(config, config.environment).order(remoteId.data));
      const packages = (values: { number: string }[]) => values.map(item => item.number).sort().join("\n");
      if (actual.entity.delivery_point !== expected.delivery_point || packages(actual.entity.packages) !== packages(expected.packages)) throw new Error("mismatch");
      matchedRemoteId = remoteId.data;
    } catch { redirect(`/admin/orders/${encodeURIComponent(input.data.number)}/?cdek=error`); }
  }
  const number = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412030)`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412026)`;
    const job = await tx.cdekDeliveryJob.findUnique({ where: { id: input.data.jobId }, include: { shipment: { include: { order: true } } } });
    if (!job || job.status !== "REVIEW" || job.shipment.order.number !== input.data.number || (job.lockedUntil && job.lockedUntil > new Date())) return null;
    const canceled = Boolean(job.cancelRequestedAt || job.shipment.order.deletedAt || ["CANCELED", "REFUNDED"].includes(job.shipment.order.status));
    let status: string;
    if (input.data.intent === "recheck" && job.remoteId) status = canceled && ["cancel-uncertain", "cancel-rejected", "already-finished"].includes(job.error ?? "") ? "CANCELING" : "ACCEPTED";
    else if (input.data.intent === "attach" && !job.remoteId && matchedRemoteId) status = "ACCEPTED";
    else if (input.data.intent === "retry" && !job.remoteId && !canceled) status = "PENDING";
    else if (input.data.intent === "absent" && !job.remoteId && canceled) status = "CANCELED";
    else return null;
    const changed = await tx.cdekDeliveryJob.updateMany({ where: { id: job.id, status: "REVIEW", remoteId: job.remoteId, OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }] }, data: { status, ...(matchedRemoteId ? { remoteId: matchedRemoteId } : {}), error: null, nextAttemptAt: new Date(), lockedUntil: null, lockToken: null } });
    if (!changed.count) return null;
    await tx.auditLog.create({ data: { actorId: user.id, action: "delivery.cdek.reconcile", entityType: "Shipment", entityId: job.shipmentId, after: { status, intent: input.data.intent } } });
    return job.shipment.order.number;
  });
  if (!number) redirect("/admin/orders/?error=confirmation");
  revalidatePath("/admin/orders/", "layout");
  redirect(`/admin/orders/${encodeURIComponent(number)}/?cdek=queued`);
}
