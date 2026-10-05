"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export async function deleteOrderAction(formData: FormData) {
  const user = await requirePermission(PERMISSIONS.ordersWrite);
  const input = z.object({ orderId: z.string().min(1).max(100), confirmation: z.string().min(1).max(100) }).safeParse({ orderId: formData.get("orderId"), confirmation: formData.get("confirmation") });
  if (!input.success) redirect("/admin/orders/?error=confirmation");
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim();
  let number: string | null;
  try {
    number = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412027)`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412026)`;
      const order = await tx.order.findUnique({ where: { id: input.data.orderId }, select: { id: true, number: true, status: true, total: true, payment: { select: { provider: true, status: true, externalId: true, payload: true } }, shipment: { select: { ozonJob: { select: { status: true } } } } } });
      if (!order) return null;
      if (order.number !== input.data.confirmation) throw new Error("confirmation");
      if (order.payment && ["tochka", "yookassa"].includes(order.payment.provider) && ["PENDING", "AUTHORIZED"].includes(order.payment.status) && (order.payment.externalId || order.payment.payload)) throw new Error("payment-active");
      if (order.shipment?.ozonJob && !["CANCELED", "FINISHED"].includes(order.shipment.ozonJob.status)) throw new Error("delivery-active");
      await tx.order.delete({ where: { id: order.id } });
      await tx.auditLog.create({ data: { actorId: user.id, action: "order.delete", entityType: "Order", entityId: order.id, ip, before: { number: order.number, status: order.status, total: String(order.total) } } });
      return order.number;
    });
  } catch (error) {
    if (error instanceof Error && error.message === "confirmation") redirect("/admin/orders/?error=confirmation");
    if (error instanceof Error && error.message === "delivery-active") redirect("/admin/orders/?error=delivery-active");
    if (error instanceof Error && error.message === "payment-active") redirect("/admin/orders/?error=payment-active");
    console.error("Could not delete order");
    redirect("/admin/orders/?error=delete");
  }
  revalidatePath("/admin", "layout");
  revalidatePath("/account", "layout");
  redirect(number ? `/admin/orders/?deleted=${encodeURIComponent(number)}` : "/admin/orders/?error=missing");
}
