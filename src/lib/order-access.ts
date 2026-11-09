import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createGuestGrant, GUEST_GRANT_SECONDS, guestGrantAllows } from "@/lib/guest-order-grant";

export async function setGuestGrantCookie(number: string, value: string) {
  (await cookies()).set(`3dp_order_${number}`, value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: GUEST_GRANT_SECONDS });
}
export async function grantOrderAccess(number: string) { await setGuestGrantCookie(number, await createGuestGrant(prisma, number)); }
export async function canAccessOrder(order: { number: string; userId: string | null; createdAt: Date; personalDataErasedAt?: Date | null }) {
  if (order.personalDataErasedAt) return false;
  const user = await getCurrentUser();
  if (user && user.id === order.userId) return true;
  const value = (await cookies()).get(`3dp_order_${order.number}`)?.value ?? "";
  return guestGrantAllows(prisma, order, value);
}
