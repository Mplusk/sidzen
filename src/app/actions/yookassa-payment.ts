"use server";

import { redirect, unstable_rethrow } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canAccessOrder } from "@/lib/order-access";
import { createYooKassaPayment } from "@/lib/yookassa/payments";
import { reconcileYooKassaPayment } from "@/lib/yookassa/payments";
import { requirePermission } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { rateLimit } from "@/lib/rate-limit";

export async function continueYooKassaPayment(form: FormData) {
  const number = String(form.get("number") ?? "");
  if (!/^3DP-\d{6}-[A-F0-9]{8}$/.test(number)) redirect("/cart/");
  const order = await prisma.order.findUnique({ where: { number }, include: { payment: true } });
  if (!order || order.deletedAt || order.payment?.provider !== "yookassa-online" || !await canAccessOrder(order)) redirect("/cart/");
  if (!rateLimit(`yookassa-continue:${order.id}`, 10, 60000).allowed) redirect(`/checkout/success/${number}/?payment=retry`);
  try {
    const url = await createYooKassaPayment(order.id);
    if (url) redirect(url);
  } catch (error) { unstable_rethrow(error); }
  redirect(`/checkout/success/${number}/?payment=retry`);
}

export async function reconcileYooKassaOrder(form: FormData) {
  const user = await requirePermission("orders.write");
  const orderId = String(form.get("orderId") ?? "");
  const externalId = String(form.get("externalId") ?? "").trim();
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, number: true, deletedAt: true } });
  if (!order || order.deletedAt) redirect("/admin/orders/?error=missing");
  const path = `/admin/orders/${order.number}/`;
  if (!rateLimit(`yookassa-reconcile:${user.id}`, 10, 60000).allowed || form.get("confirmation") !== order.number) redirect(`${path}?yookassa=error`);
  let success = false;
  try {
    await reconcileYooKassaPayment(order.id, externalId);
    await prisma.auditLog.create({ data: { actorId: user.id, action: "payment.reconcile", entityType: "Order", entityId: order.id, after: { provider: "yookassa-online", externalId } } });
    success = true;
  } catch { /* Report the failure without exposing provider details. */ }
  revalidatePath(path);
  redirect(`${path}?yookassa=${success ? "updated" : "error"}`);
}
