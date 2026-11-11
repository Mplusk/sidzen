"use server";

import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { restoreExpiredOrderStock } from "@/lib/late-order-stock";
import { removeUnchangedReturnedItems } from "@/lib/order-cart-restore";

export async function reserveLatePaidOrder(form: FormData) {
  const user = await requirePermission(PERMISSIONS.ordersWrite);
  const id = String(form.get("orderId") ?? "");
  const number = String(form.get("number") ?? "");
  if (!id || id.length > 100 || !/^3DP-\d{6}-[A-F0-9]{8}$/.test(number)) redirect("/admin/orders/?error=missing");
  let reserved = false;
  try {
    reserved = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412026)`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412034)`;
      const order = await tx.order.findUnique({ where: { id }, include: { payment: true } });
      if (!order || order.number !== number || order.deletedAt || !order.reservationExpiredAt || !order.stockReviewRequired || order.status !== "PAID" || order.payment?.status !== "PAID") return false;
      if (!await restoreExpiredOrderStock(tx, id)) return false;
      await removeUnchangedReturnedItems(tx, id);
      await tx.order.update({ where: { id }, data: { stockReviewRequired: false } });
      await tx.auditLog.create({ data: { actorId: user.id, action: "order.stock.late-payment-reserved", entityType: "Order", entityId: id } });
      return true;
    });
  } catch { reserved = false; }
  if (reserved) updateTag("catalog");
  revalidatePath("/admin", "layout");
  revalidatePath("/account", "layout");
  redirect(`/admin/orders/${number}/?stock=${reserved ? "reserved" : "unavailable"}`);
}
