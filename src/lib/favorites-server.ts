import { cookies } from "next/headers";
import { cache } from "react";
import { prisma } from "./prisma";
import { getCurrentUser } from "./auth";
import { FAVORITES_COOKIE, MAX_FAVORITES, favoriteIds } from "./favorites-policy";
export const favoriteProductWhere = { status: "PUBLISHED" as const, type: { in: ["READY" as const, "PARAMETRIC" as const] }, categories: { some: { category: { visible: true } } } };
export const getFavoriteIds = cache(async () => {
  const user = await getCurrentUser();
  if (user) return (await prisma.productFavorite.findMany({ where: { userId: user.id, product: favoriteProductWhere }, select: { productId: true }, orderBy: { createdAt: "desc" }, take: MAX_FAVORITES })).map(row => row.productId);
  const ids = favoriteIds((await cookies()).get(FAVORITES_COOKIE)?.value);
  if (!ids.length) return [];
  const visible = new Set((await prisma.product.findMany({ where: { ...favoriteProductWhere, id: { in: ids } }, select: { id: true } })).map(row => row.id));
  return ids.filter(id => visible.has(id));
});
export async function getCartQuantity() {
  const user = await getCurrentUser(), key = (await cookies()).get("3dp_cart")?.value;
  if (!user && !key) return 0;
  const result = await prisma.cartItem.aggregate({ where: { cart: user ? { userId: user.id } : { sessionKey: key }, product: { type: { in: ["READY", "PARAMETRIC"] } } }, _sum: { quantity: true } });
  return result._sum.quantity ?? 0;
}
