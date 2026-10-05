"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canAccessOrder } from "@/lib/order-access";
import { createOnlinePayment } from "@/lib/payments";
import { rateLimit } from "@/lib/rate-limit";

export async function payOrderAction(form: FormData) {
  const order = await prisma.order.findUnique({ where: { id: String(form.get("orderId") ?? "") } });
  if (!order || !(await canAccessOrder(order))) redirect("/account/");
  if (!rateLimit(`pay-order:${order.id}`, 5, 60_000).allowed) redirect(`/checkout/success/${order.number}/?error=payment`);
  let url: string | null;
  try { url = await createOnlinePayment(order.id); } catch { redirect(`/checkout/success/${order.number}/?error=payment`); }
  redirect(url ?? `/checkout/success/${order.number}/`);
}
