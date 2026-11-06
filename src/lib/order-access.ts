import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { guestOrderSignature, validGuestOrderGrant } from "@/lib/guest-order-grant";

export async function grantOrderAccess(number: string) {
  (await cookies()).set(`3dp_order_${number}`, guestOrderSignature(number), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
}
export async function canAccessOrder(order: { number: string; userId: string | null; personalDataErasedAt?: Date | null }) {
  if (order.personalDataErasedAt) return false;
  const user = await getCurrentUser();
  if (user && user.id === order.userId) return true;
  const value = (await cookies()).get(`3dp_order_${order.number}`)?.value ?? "";
  return validGuestOrderGrant(order.number, value);
}
