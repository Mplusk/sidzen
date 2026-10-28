"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { favoriteProductWhere, getFavoriteIds } from "@/lib/favorites-server";
import { FAVORITES_COOKIE, MAX_FAVORITES, selectFavorite } from "@/lib/favorites-policy";
import { rateLimit } from "@/lib/rate-limit";
export async function setFavorite(productId: string, selected: boolean): Promise<{ error?: string }> {
  if (typeof productId !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(productId) || typeof selected !== "boolean") return { error: "Не удалось изменить избранное." };
  if (!rateLimit("favorites-mutations", 600, 60000).allowed) return { error: "Слишком много запросов. Попробуйте чуть позже." };
  const user = await getCurrentUser();
  try {
    if (user) await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412048)`;
      if (!selected) { await tx.productFavorite.deleteMany({ where: { userId: user.id, productId } }); return; }
      if (!await tx.product.findFirst({ where: { ...favoriteProductWhere, id: productId }, select: { id: true } })) throw new Error("unavailable");
      const existing = await tx.productFavorite.findUnique({ where: { userId_productId: { userId: user.id, productId } } });
      if (!existing && await tx.productFavorite.count({ where: { userId: user.id, product: favoriteProductWhere } }) >= MAX_FAVORITES) throw new Error("limit");
      await tx.productFavorite.upsert({ where: { userId_productId: { userId: user.id, productId } }, create: { userId: user.id, productId }, update: {} });
    });
    else {
      const ids = await getFavoriteIds();
      if (selected && !await prisma.product.findFirst({ where: { ...favoriteProductWhere, id: productId }, select: { id: true } })) throw new Error("unavailable");
      const next = selectFavorite(ids, productId, selected);
      if (next.length > MAX_FAVORITES) throw new Error("limit");
      const jar = await cookies();
      if (next.length) jar.set(FAVORITES_COOKIE, next.join("."), { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 30 * 86400 });
      else jar.delete(FAVORITES_COOKIE);
    }
  } catch (error) {
    return { error: error instanceof Error && error.message === "limit" ? `Можно сохранить до ${MAX_FAVORITES} товаров. Удалите ненужные из избранного.` : "Не удалось сохранить выбор. Возможно, товар больше недоступен. Попробуйте ещё раз." };
  }
  revalidatePath("/", "layout");
  return {};
}
