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
      const order = await tx.order.findUnique({ where: { id: input.data.orderId }, select: { id: true, number: true, status: true, total: true, deletedAt: true } });
      if (!order || order.deletedAt) return null;
      if (order.number !== input.data.confirmation) throw new Error("confirmation");
      // Hide from working lists, preserving payment, receipt and carrier
      // history for reconciliation. This does not cancel external operations.
      await tx.order.update({ where: { id: order.id }, data: { deletedAt: new Date() } });
      await tx.auditLog.create({ data: { actorId: user.id, action: "order.delete", entityType: "Order", entityId: order.id, ip, before: { number: order.number, status: order.status, total: String(order.total) }, after: { archived: true } } });
      return order.number;
    });
  } catch (error) {
    if (error instanceof Error && error.message === "confirmation") redirect("/admin/orders/?error=confirmation");
    console.error("Could not delete order");
    redirect("/admin/orders/?error=delete");
  }
  revalidatePath("/admin", "layout");
  revalidatePath("/account", "layout");
  redirect(number ? `/admin/orders/?deleted=${encodeURIComponent(number)}` : "/admin/orders/?error=missing");
}
