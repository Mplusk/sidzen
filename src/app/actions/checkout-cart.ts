"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCart } from "@/app/actions/cart";
import { priceProduct } from "@/lib/product-options";

/** Update only the current visitor's unchanged cart row; checkout rechecks pricing again on submission. */
export async function updateCheckoutCartItem(id: string, expected: number, quantity: number): Promise<{ error?: string }> {
  if (typeof id !== "string" || id.length < 1 || id.length > 100 || !Number.isInteger(expected) || !Number.isInteger(quantity) || expected < 1 || quantity < 0 || quantity > 999) return { error: "Не удалось изменить количество. Обновите корзину." };
  const cart = await getCart();
  const item = cart?.items.find(value => value.id === id);
  if (!cart || !item || item.quantity !== expected) return { error: "Корзина изменилась. Проверьте состав заказа." };
  const where = { id: item.id, cartId: cart.id, quantity: item.quantity, updatedAt: item.updatedAt };
  if (quantity === 0) {
    const removed = await prisma.cartItem.deleteMany({ where });
    if (!removed.count) return { error: "Корзина изменилась. Проверьте состав заказа." };
  } else {
    if (!item.available || !item.options || !item.product) return { error: "Товар недоступен. Проверьте корзину." };
    if (!item.product.madeToOrder && quantity > item.product.stock) return { error: "Такого количества нет в наличии." };
    let quote;
    try { quote = priceProduct(item.options, { ...item.selection, quantity }); }
    catch { return { error: "Не удалось рассчитать товар. Проверьте корзину." }; }
    const updated = await prisma.cartItem.updateMany({ where, data: { quantity, unitPrice: quote.unitPrice, variantId: quote.variantId ?? null, config: quote.config } });
    if (!updated.count) return { error: "Корзина изменилась. Проверьте состав заказа." };
  }
  revalidatePath("/", "layout");
  return {};
}
