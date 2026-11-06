"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { manualDeliveryDate, validDeliveryDate } from "@/lib/delivery/estimated-date";

export async function updateDeliveryEstimate(formData: FormData) {
  const actor = await requirePermission(PERMISSIONS.ordersWrite);
  const input = z.object({ orderId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/), number: z.string().min(1).max(100), date: z.string().max(10) }).safeParse({ orderId: formData.get("orderId"), number: formData.get("number"), date: formData.get("date") });
  if (!input.success) redirect("/admin/orders/?error=invalid");
  const path = `/admin/orders/${encodeURIComponent(input.data.number)}/`;
  if (input.data.date && !validDeliveryDate(input.data.date)) redirect(`${path}?eta=invalid`);
  const result = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412026)`;
    const order = await tx.order.findUnique({ where: { id: input.data.orderId }, select: { number: true, deletedAt: true, personalDataErasedAt: true, shipment: { select: { id: true, payload: true } } } });
    if (!order || order.number !== input.data.number || order.deletedAt || order.personalDataErasedAt || !order.shipment) return "missing";
    const before = order.shipment.payload;
    if (before !== null && (typeof before !== "object" || Array.isArray(before))) return "unsupported";
    const payload: Record<string, unknown> = { ...(before ?? {}) };
    if (input.data.date) payload.deliveryEstimateDate = input.data.date;
    else delete payload.deliveryEstimateDate;
    await tx.shipment.update({ where: { id: order.shipment.id }, data: { payload: payload as Prisma.InputJsonObject } });
    await tx.auditLog.create({ data: { actorId: actor.id, action: "shipment.estimate.update", entityType: "Shipment", entityId: order.shipment.id, before: { date: manualDeliveryDate(before) }, after: { date: input.data.date || null } } });
    return "saved";
  });
  revalidatePath("/admin", "layout");
  revalidatePath("/account", "layout");
  redirect(`${path}?eta=${result}`);
}
