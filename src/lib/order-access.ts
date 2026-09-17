import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth";

function signature(number: string) {
  if (!process.env.AUTH_SECRET) throw new Error("AUTH_SECRET is required");
  return createHmac("sha256", process.env.AUTH_SECRET).update(`order:${number}`).digest("hex");
}
export async function grantOrderAccess(number: string) {
  (await cookies()).set(`3dp_order_${number}`, signature(number), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
}
export async function canAccessOrder(order: { number: string; userId: string | null }) {
  const user = await getCurrentUser();
  if (user && user.id === order.userId) return true;
  const value = (await cookies()).get(`3dp_order_${order.number}`)?.value ?? "";
  const expected = signature(order.number);
  return /^[a-f0-9]{64}$/.test(value) && timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}
