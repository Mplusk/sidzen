"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath, updateTag } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { writeProductPrice } from "@/lib/product-price-write";

export type ProductPriceState = { success: boolean; message: string };

// Decimal text avoids float rounding and an empty required field becoming zero.
function amount(value: FormDataEntryValue | null, optional = false): Prisma.Decimal | null | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text && optional) return null;
  if (!/^\d{1,9}(?:[.,]\d{1,2})?$/.test(text)) return undefined;
  const parsed = new Prisma.Decimal(text.replace(",", "."));
  return parsed.lte(999_999_999) ? parsed : undefined;
}

export async function updateProductPriceAction(_previous: ProductPriceState, form: FormData): Promise<ProductPriceState> {
  const user = await requirePermission(PERMISSIONS.productsWrite);
  const id = form.get("id");
  const version = form.get("productVersion");
  const originalStatus = form.get("originalStatus");
  const basePrice = amount(form.get("basePrice"));
  const oldPrice = amount(form.get("oldPrice"), true);
  const originalBasePrice = amount(form.get("originalBasePrice"));
  const originalOldPrice = amount(form.get("originalOldPrice"), true);
  const date = typeof version === "string" ? new Date(version) : new Date(NaN);
  if (typeof id !== "string" || !id || id.length > 100 || typeof originalStatus !== "string" || !["DRAFT", "REVIEW", "PUBLISHED", "HIDDEN", "ARCHIVED"].includes(originalStatus) || typeof version !== "string" || !Number.isFinite(date.getTime()) || date.toISOString() !== version || basePrice == null || oldPrice === undefined || originalBasePrice == null || originalOldPrice === undefined) {
    return { success: false, message: "Проверьте цену: допустимы суммы от 0 до 999 999 999 ₽ с точностью до копейки." };
  }
  if (!rateLimit(`product-price:${user.id}`, 60, 60_000).allowed) return { success: false, message: "Слишком много изменений. Повторите через минуту." };
  const canPublish = user.permissions.has(PERMISSIONS.productsPublish) || user.roles.includes("superadmin");
  try {
    await prisma.$transaction(tx => writeProductPrice(tx, { id, version: date, originalStatus, basePrice, oldPrice, originalBasePrice, originalOldPrice, actorId: user.id, canPublish, acceptSiteMode: form.get("acceptSiteMode") === "on" }));
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const message = code === "stale" ? "Товар изменился. Обновите список и повторите." : code === "confirm-site-mode" ? "Для сохранения карточку нужно перевести на данные сайта. Обновите список и подтвердите изменение." : code === "permission" ? "Для изменения опубликованного товара необходимо право публикации." : code === "missing" ? "Товар больше не найден. Обновите список." : code === "marketplace-busy" ? "Дождитесь завершения синхронизации с маркетплейсами." : "Не удалось сохранить цену. Попробуйте ещё раз.";
    return { success: false, message };
  }
  updateTag("catalog");
  revalidatePath("/catalog/", "layout");
  revalidatePath("/admin/products/", "layout");
  return { success: true, message: "Цена сохранена." };
}
