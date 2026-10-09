import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
export const metadata = { robots: { index: false, follow: false }, title: "Уведомление о заказе" };
export default async function OrderAlert({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("orders.read");
  const { id } = await params;
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) notFound();
  const order = await prisma.order.findFirst({ where: { id, deletedAt: null }, select: { number: true } });
  if (!order) notFound();
  redirect(`/admin/orders/${encodeURIComponent(order.number)}/`);
}
