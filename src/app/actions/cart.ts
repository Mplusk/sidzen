"use server";

import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath, updateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { defaultSelection, priceProduct, type ProductSelection } from "@/lib/product-options";
import { productOptionInclude, productOptions } from "@/lib/product-options-server";
import { legacyStockReviewProductIds } from "@/lib/legacy-stock-availability";
import { adjustLockedCartHold, expireCartHold, holdCartForCheckout, lockCartHold } from "@/lib/cart-stock-holds";

const CART_COOKIE = "3dp_cart";

export async function getOrCreateCart() {
  const user = await getCurrentUser();
  if (user) return prisma.cart.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id } });
  const cookieStore = await cookies();
  let key = cookieStore.get(CART_COOKIE)?.value;
  if (!key) {
    key = randomBytes(24).toString("base64url");
    cookieStore.set(CART_COOKIE, key, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 30, path: "/" });
  }
  return prisma.cart.upsert({ where: { sessionKey: key }, update: {}, create: { sessionKey: key } });
}


function selectionFromForm(form: FormData): ProductSelection {
  return { material: String(form.get("material") ?? ""), color: String(form.get("color") ?? ""), quantity: Number(form.get("quantity")) };
}

async function saveProduct(formData: FormData) {
  const product = await prisma.product.findFirst({ where: { id: String(formData.get("productId") ?? ""), status: "PUBLISHED", type: { in: ["READY", "PARAMETRIC"] } }, include: productOptionInclude });
  if (!product) redirect("/cart/?error=unavailable");
  const selection = selectionFromForm(formData);
  let quote;
  try { quote = priceProduct(productOptions(product), selection); } catch { redirect("/cart/?error=options"); }
  const cart = await getOrCreateCart();
  if ((await legacyStockReviewProductIds([product.id])).has(product.id)) redirect("/cart/?error=stock-review");
  const data = { quantity: selection.quantity, unitPrice: quote.unitPrice, variantId: quote.variantId ?? null, config: quote.config };
  const saved = await prisma.$transaction(async tx => {
    const { hold, products } = await lockCartHold(tx, cart.id, [product.id]);
    const current = products.find(value => value.id === product.id);
    if (!current || current.status !== "PUBLISHED" || (await legacyStockReviewProductIds([product.id], tx)).has(product.id)) return false;
    const rows = await tx.cartItem.findMany({ where: { cartId: cart.id, productId: product.id }, select: { id: true, quantity: true } });
    const otherQuantity = rows.reduce((sum, row) => sum + row.quantity, 0);
    const owned = hold?.items.find(item => item.productId === product.id)?.quantity ?? 0;
    if (!current.madeToOrder && otherQuantity + selection.quantity > current.stock - current.reservedStock + owned) return false;
    await adjustLockedCartHold(tx, hold, current, product.id, otherQuantity + selection.quantity);
    await tx.cartItem.create({ data: { cartId: cart.id, productId: product.id, ...data } });
    return true;
  });
  if (!saved) redirect("/cart/?error=stock");
  revalidatePath("/", "layout");
  redirect("/cart/");
}

export async function addProductToCart(formData: FormData) { return saveProduct(formData); }

export async function startCheckout() {
  const cart = await getCart();
  if (!cart?.items.length) redirect("/cart/?error=empty");
  try { await holdCartForCheckout(prisma, cart); }
  catch { redirect("/cart/?error=unavailable"); }
  updateTag("catalog");
  revalidatePath("/", "layout");
  redirect("/checkout/");
}
// Retained for old clients; editing must use the version-checked group action.
export async function updateCartItem() { redirect("/cart/?error=changed"); }

export async function removeCartGroup(formData: FormData) {
  const raw = formData.get("members");
  if (typeof raw !== "string" || raw.length > 200000) redirect("/cart/?error=changed");
  let members;
  try { members = JSON.parse(raw); } catch { redirect("/cart/?error=changed"); }
  const { updateCheckoutCartGroup } = await import("@/app/actions/checkout-cart");
  const result = await updateCheckoutCartGroup(members, 0);
  redirect(result.error ? "/cart/?error=changed" : "/cart/");
}

export async function getCart() {
  const user = await getCurrentUser();
  const key = (await cookies()).get(CART_COOKIE)?.value;
  if (!user && !key) return null;
  const cartQuery = {
    where: user ? { userId: user.id } : { sessionKey: key },
    include: { stockHold: { include: { items: true } }, items: { where: { product: { type: { in: ["READY", "PARAMETRIC"] } } }, include: { product: { include: { ...productOptionInclude, images: { orderBy: { sortOrder: "asc" }, take: 1 }, categories: { include: { category: true } } } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  } satisfies Prisma.CartFindFirstArgs;
  let cart = await prisma.cart.findFirst(cartQuery);
  if (!cart) return null;
  if (cart.stockHold && cart.stockHold.expiresAt <= new Date()) {
    await expireCartHold(prisma, cart.stockHold.id);
    cart = await prisma.cart.findFirst(cartQuery);
    if (!cart) return null;
  }
  const owned = new Map((cart.stockHold && cart.stockHold.expiresAt > new Date() ? cart.stockHold.items : []).map(item => [item.productId, item.quantity]));
  const stockReview = await legacyStockReviewProductIds(cart.items.flatMap(item => item.productId ? [item.productId] : []));
  const quantities = new Map<string | null, number>();
  for (const item of cart.items) quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
  return { ...cart, items: cart.items.map((item) => {
    const options = item.product ? productOptions(item.product) : null;
    if (options && item.productId) options.stock += owned.get(item.productId) ?? 0;
    const config = (item.config ?? {}) as Record<string, unknown>;
    const defaults = options ? defaultSelection(options) : { material: "", color: "", quantity: 1 };
    const selection = { material: String(config.material ?? defaults.material), color: String(config.color ?? defaults.color), quantity: item.quantity };
    const stockReviewRequired = !!item.productId && stockReview.has(item.productId);
    const groupState = createHash("sha256").update(JSON.stringify([item.productId, item.variantId, item.modelFileId, item.config])).digest("hex");
    try {
      if (!options || item.product?.status !== "PUBLISHED") throw new Error("unavailable");
      const quote = priceProduct(options, selection);
      const keys = Object.keys(config);
      const validConfig = item.config === null || (typeof item.config === "object" && !Array.isArray(item.config));
      const groupKey = validConfig && !item.modelFileId && keys.every(key => ["material", "materialName", "color", "colorName"].includes(key)) && item.variantId === (quote.variantId ?? null) ? JSON.stringify([item.productId, item.variantId, quote.config.material, quote.config.color, quote.unitPrice]) : null;
      const canStartCheckout = options.madeToOrder || options.stock >= (quantities.get(item.productId) ?? item.quantity);
      return { ...item, unitPrice: quote.unitPrice, config: quote.config, options, selection, stockReviewRequired, groupKey, groupState, canStartCheckout, available: !stockReviewRequired && canStartCheckout, quote };
    } catch {
      return { ...item, unitPrice: Number(item.unitPrice), options, selection: { ...defaults, quantity: item.quantity }, stockReviewRequired, groupKey: null, groupState, canStartCheckout: false, available: false, quote: null };
    }
  }) };
}
