import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requirePermission("orders.read", `/admin/order-alert/${encodeURIComponent(id)}/`);
  const missing = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return missing();
  const order = await prisma.order.findFirst({ where: { id, deletedAt: null }, select: { number: true } });
  if (!order) return missing();
  redirect(`/admin/orders/${encodeURIComponent(order.number)}/`);
}
