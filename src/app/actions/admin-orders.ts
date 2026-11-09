"use server";

import { revalidatePath, updateTag } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { releaseUnsentStock } from "@/lib/stock-reservations";
import { revokeGuestGrantsForOrder } from "@/lib/guest-order-grant";

export async function deleteOrderAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.ordersWrite);
  const input = z.object({ orderId: z.string().min(1).max(100), confirmation: z.string().min(1).max(100) }).safeParse({ orderId: formData.get("orderId"), confirmation: formData.get("confirmation") });
  if (!input.success) redirect("/admin/orders/?error=confirmation");
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim();
  let number: string | null;
  try {
    number = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412027)`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412030)`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412026)`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412034)`;
      const order = await tx.order.findUnique({ where: { id: input.data.orderId }, select: { id: true, number: true, status: true, total: true, deletedAt: true, payment: { select: { provider: true, status: true } }, shipment: { select: { ozonJob: { select: { id: true } }, cdekJob: { select: { id: true, status: true } } } } } });
      if (!order || order.deletedAt) return null;
      if (order.number !== input.data.confirmation) throw new Error("confirmation");
      if (order.payment?.provider === "yookassa-online" && !["CANCELED", "REFUNDED"].includes(order.payment.status)) throw new Error("payment-active");
      if (!order.payment || order.payment.status === "CANCELED") await releaseUnsentStock(tx, order.id);
      await revokeGuestGrantsForOrder(tx, order.number);
      // Commit cancellation intent with archival. Do not clear an active lease:
      // an in-flight create must save its remote identifiers for cancellation.
      if (order.shipment?.ozonJob) await tx.ozonDeliveryJob.update({ where: { id: order.shipment.ozonJob.id }, data: { cancelRequestedAt: new Date(), cancelError: null, nextAttemptAt: new Date() } });
      if (order.shipment?.cdekJob && order.shipment.cdekJob.status !== "CANCELED") await tx.cdekDeliveryJob.update({ where: { id: order.shipment.cdekJob.id }, data: { cancelRequestedAt: new Date(), nextAttemptAt: new Date(), ...(order.shipment.cdekJob.status === "FINISHED" ? { status: "REVIEW", error: "already-finished" } : {}) } });
      await tx.order.update({ where: { id: order.id }, data: { deletedAt: new Date(), privacyClosedAt: new Date() } });
      await tx.auditLog.create({ data: { actorId: user.id, action: "order.delete", entityType: "Order", entityId: order.id, ip, before: { number: order.number, status: order.status, total: String(order.total) }, after: { archived: true } } });
      return order.number;
    });
  } catch (error) {
    if (error instanceof Error && error.message === "confirmation") redirect("/admin/orders/?error=confirmation");
    if (error instanceof Error && error.message === "payment-active") redirect("/admin/orders/?error=payment-active");
    console.error("Could not delete order");
    redirect("/admin/orders/?error=delete");
  }
  updateTag("catalog");
  revalidatePath("/admin", "layout");
  revalidatePath("/account", "layout");
  redirect(number ? `/admin/orders/?deleted=${encodeURIComponent(number)}` : "/admin/orders/?error=missing");
}
