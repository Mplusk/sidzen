"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCart } from "@/app/actions/cart";
import { priceProduct } from "@/lib/product-options";
import { groupCartItems, type CartGroupMember } from "@/lib/cart-groups";
import { createHash } from "node:crypto";
import { legacyStockReviewProductIds } from "@/lib/legacy-stock-availability";
import { adjustLockedCartHold, lockCartHold } from "@/lib/cart-stock-holds";

/** Update all displayed copies as one atomic operation; never trust client-supplied rows. */
export async function updateCheckoutCartGroup(members: CartGroupMember[], quantity: number): Promise<{ error?: string }> {
  if (!Array.isArray(members) || !members.length || members.length > 999 || !Number.isInteger(quantity) || quantity < 0 || quantity > 999 || members.some(m => !m || typeof m.id !== "string" || m.id.length > 100 || !Number.isInteger(m.quantity) || m.quantity < 1 || typeof m.state !== "string" || !/^[a-f0-9]{64}$/.test(m.state) || typeof m.revision !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(m.revision))) return { error: "Не удалось изменить корзину. Обновите страницу." };
  const cart = await getCart();
  const group = cart && groupCartItems(cart.items).find(item => item.id === members[0].id);
  if (!cart || !group || JSON.stringify(group.members) !== JSON.stringify(members)) return { error: "Корзина изменилась. Проверьте состав заказа." };
  let quote = group.quote;
  if (quantity > 0) {
    if (!group.groupKey || !group.quote || !group.options || !group.product || !group.productId || group.stockReviewRequired) return { error: "Эту позицию нельзя изменить. Удалите её и добавьте товар заново." };
    const ids = new Set(members.map(m => m.id));
    const otherQuantity = cart.items.filter(item => !ids.has(item.id) && item.productId === group.productId).reduce((sum, item) => sum + item.quantity, 0);
    if (!group.product.madeToOrder && quantity + otherQuantity > group.options.stock) return { error: "Такого количества нет в наличии." };
    try { quote = priceProduct(group.options, { ...group.selection, quantity }); } catch { return { error: "Не удалось рассчитать товар. Проверьте корзину." }; }
  }
  try {
    await prisma.$transaction(async tx => {
      const { hold, products } = await lockCartHold(tx, cart.id, group.productId ? [group.productId] : []);
      await tx.$queryRaw`SELECT "id" FROM "CartItem" WHERE "cartId" = ${cart.id} FOR UPDATE`;
      const current = await tx.cartItem.findMany({ where: { cartId: cart.id, product: { type: { in: ["READY", "PARAMETRIC"] } } }, select: { id: true, productId: true, variantId: true, modelFileId: true, config: true, quantity: true, updatedAt: true } });
      const state = (item: typeof current[number]) => createHash("sha256").update(JSON.stringify([item.productId, item.variantId, item.modelFileId, item.config])).digest("hex");
      if (current.length !== cart.items.length || cart.items.some(item => !current.some(row => row.id === item.id && row.quantity === item.quantity && row.updatedAt.getTime() === item.updatedAt.getTime() && state(row) === item.groupState))) throw new Error("cart-changed");
      if (group.productId) {
        const product = products.find(value => value.id === group.productId);
        const other = current.filter(row => row.productId === group.productId && !members.some(m => m.id === row.id)).reduce((sum, row) => sum + row.quantity, 0);
        const owned = hold?.items.find(item => item.productId === group.productId)?.quantity ?? 0;
        if (quantity && (!product || product.status !== "PUBLISHED" || (!product.madeToOrder && quantity + other > product.stock - product.reservedStock + owned) || (await legacyStockReviewProductIds([group.productId], tx)).has(group.productId))) throw new Error("cart-changed");
        await adjustLockedCartHold(tx, hold, product, group.productId, quantity + other, quantity > 0);
      }
      for (let i = 0; i < members.length; i++) {
        const member = members[i];
        const where = { id: member.id, cartId: cart.id, quantity: member.quantity, updatedAt: new Date(member.revision) };
        const result = quantity && i === 0 && quote ? await tx.cartItem.updateMany({ where, data: { quantity, unitPrice: quote.unitPrice, variantId: quote.variantId ?? null, config: quote.config } }) : await tx.cartItem.deleteMany({ where });
        if (result.count !== 1) throw new Error("cart-changed");
      }
    });
  } catch { return { error: "Корзина изменилась. Проверьте состав заказа." }; }
  revalidatePath("/", "layout");
  return {};
}

