import { cookies } from "next/headers";
import { prisma } from "./prisma";
import { favoriteIds, FAVORITES_COOKIE, MAX_FAVORITES } from "./favorites-policy";
export async function mergeGuestFavorites(userId: string) {
  const jar = await cookies(), ids = favoriteIds(jar.get(FAVORITES_COOKIE)?.value);
  if (!ids.length) return;
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412048)`;
    const current = await tx.productFavorite.findMany({ where: { userId, product: { status: "PUBLISHED", type: { in: ["READY", "PARAMETRIC"] }, categories: { some: { category: { visible: true } } } } }, select: { productId: true } });
    const existing = new Set(current.map(row => row.productId));
    const products = await tx.product.findMany({ where: { id: { in: ids.filter(id => !existing.has(id)) }, status: "PUBLISHED", type: { in: ["READY", "PARAMETRIC"] }, categories: { some: { category: { visible: true } } } }, select: { id: true }, take: Math.max(0, MAX_FAVORITES - current.length) });
    await tx.productFavorite.createMany({ data: products.map(row => ({ userId, productId: row.id })), skipDuplicates: true });
  });
  jar.delete(FAVORITES_COOKIE);
}
