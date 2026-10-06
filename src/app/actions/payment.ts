"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canAccessOrder } from "@/lib/order-access";

export async function payOrderAction(form: FormData) {
  const order = await prisma.order.findUnique({ where: { id: String(form.get("orderId") ?? "") } });
  if (!order || !(await canAccessOrder(order))) redirect("/account/");
  // Fail closed for stale browser forms from the former payment checkout.
  redirect(`/checkout/success/${order.number}/?notice=contact`);
}
