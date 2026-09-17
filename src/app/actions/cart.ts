"use server";

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { defaultSelection, priceProduct, type ProductSelection } from "@/lib/product-options";
import { productOptionInclude, productOptions } from "@/lib/product-options-server";

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
  return { material: String(form.get("material") ?? ""), color: String(form.get("color") ?? ""), quality: String(form.get("quality") ?? ""), quantity: Number(form.get("quantity")) };
}

async function saveProduct(formData: FormData, editing: boolean) {
  const product = await prisma.product.findFirst({ where: { id: String(formData.get("productId") ?? ""), status: "PUBLISHED", type: { in: ["READY", "PARAMETRIC"] } }, include: productOptionInclude });
  if (!product) redirect("/cart/?error=unavailable");
  const selection = selectionFromForm(formData);
  let quote;
  try { quote = priceProduct(productOptions(product), selection); } catch { redirect("/cart/?error=options"); }
  if (!product.madeToOrder && selection.quantity > product.stock) redirect("/cart/?error=stock");
  const cart = await getOrCreateCart();
  const data = { quantity: selection.quantity, unitPrice: quote.unitPrice, variantId: quote.variantId ?? null, config: quote.config };
  if (editing) {
    await prisma.cartItem.updateMany({ where: { id: String(formData.get("id") ?? ""), cartId: cart.id, productId: product.id }, data });
  } else {
    await prisma.cartItem.create({ data: { cartId: cart.id, productId: product.id, ...data } });
  }
  redirect("/cart/");
}

export async function addProductToCart(formData: FormData) { return saveProduct(formData, false); }
export async function updateCartItem(formData: FormData) { return saveProduct(formData, true); }

export async function removeCartItem(formData: FormData) {
  const cart = await getOrCreateCart();
  await prisma.cartItem.deleteMany({ where: { id: String(formData.get("id") ?? ""), cartId: cart.id } });
  redirect("/cart/");
}

export async function getCart() {
  const user = await getCurrentUser();
  const key = (await cookies()).get(CART_COOKIE)?.value;
  if (!user && !key) return null;
  const cart = await prisma.cart.findFirst({
    where: user ? { userId: user.id } : { sessionKey: key },
    include: { items: { where: { product: { type: { in: ["READY", "PARAMETRIC"] } } }, include: { product: { include: { ...productOptionInclude, images: { orderBy: { sortOrder: "asc" }, take: 1 }, categories: { include: { category: true } } } } }, orderBy: { createdAt: "asc" } } },
  });
  if (!cart) return null;
  return { ...cart, items: cart.items.map((item) => {
    const options = item.product ? productOptions(item.product) : null;
    const config = (item.config ?? {}) as Record<string, unknown>;
    const defaults = options ? defaultSelection(options) : { material: "", color: "", quality: "", quantity: 1 };
    const selection = { material: String(config.material ?? defaults.material), color: String(config.color ?? defaults.color), quality: String(config.quality ?? defaults.quality), quantity: item.quantity };
    try {
      if (!options || item.product?.status !== "PUBLISHED") throw new Error("unavailable");
      const quote = priceProduct(options, selection);
      return { ...item, unitPrice: quote.unitPrice, config: quote.config, options, selection, available: options.madeToOrder || options.stock >= item.quantity, quote };
    } catch {
      return { ...item, unitPrice: Number(item.unitPrice), options, selection: { ...defaults, quantity: item.quantity }, available: false, quote: null };
    }
  }) };
}
