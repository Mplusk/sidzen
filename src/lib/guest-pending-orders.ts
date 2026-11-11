import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { guestGrantAllows } from "@/lib/guest-order-grant";
import { canContinuePayment } from "@/lib/payment-availability";
import { prisma } from "@/lib/prisma";

/** Only a valid order-scoped browser grant may reveal a guest order. */
export async function getGuestPendingOrders() {
  if (await getCurrentUser()) return [];
  const grants = (await cookies()).getAll().filter(cookie => /^3dp_order_3DP-\d{6}-[A-F0-9]{8}$/.test(cookie.name)).slice(0, 20);
  if (!grants.length) return [];
  const values = new Map(grants.map(grant => [grant.name.slice("3dp_order_".length), grant.value]));
  const orders = await prisma.order.findMany({
    where: { number: { in: [...values.keys()] }, userId: null, deletedAt: null, personalDataErasedAt: null, status: { in: ["NEW", "APPROVED", "AWAITING_PAYMENT"] }, payment: { is: { provider: "yookassa-online", status: "PENDING" } } },
    include: { payment: true }, orderBy: { createdAt: "desc" }, take: 20,
  });
  const checked = await Promise.all(orders.map(async order => canContinuePayment(order) && await guestGrantAllows(prisma, order, values.get(order.number) ?? "") ? order : null));
  return checked.filter((order): order is NonNullable<typeof order> => order !== null);
}
