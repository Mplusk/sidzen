"use server";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { defaultSelection, priceProduct, type ProductSelection } from "@/lib/product-options";
import { productOptionInclude, productOptions } from "@/lib/product-options-server";
import { legacyStockReviewProductIds } from "@/lib/legacy-stock-availability";

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
  if (!product.madeToOrder && selection.quantity > productOptions(product).stock) redirect("/cart/?error=stock");
  const cart = await getOrCreateCart();
  if ((await legacyStockReviewProductIds([product.id])).has(product.id)) redirect("/cart/?error=stock-review");
  const data = { quantity: selection.quantity, unitPrice: quote.unitPrice, variantId: quote.variantId ?? null, config: quote.config };
  const saved = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${product.id} FOR KEY SHARE`;
    await tx.$queryRaw`SELECT "id" FROM "Cart" WHERE "id" = ${cart.id} FOR UPDATE`;
    const current = await tx.product.findUnique({ where: { id: product.id }, select: { stock: true, reservedStock: true, madeToOrder: true, status: true } });
    if (!current || current.status !== "PUBLISHED" || (await legacyStockReviewProductIds([product.id], tx)).has(product.id)) return false;
    const rows = await tx.cartItem.findMany({ where: { cartId: cart.id, productId: product.id }, select: { id: true, quantity: true } });
    const otherQuantity = rows.reduce((sum, row) => sum + row.quantity, 0);
    if (!current.madeToOrder && otherQuantity + selection.quantity > current.stock - current.reservedStock) return false;
    await tx.cartItem.create({ data: { cartId: cart.id, productId: product.id, ...data } });
    return true;
  });
  if (!saved) redirect("/cart/?error=stock");
  revalidatePath("/", "layout");
  redirect("/cart/");
}

export async function addProductToCart(formData: FormData) { return saveProduct(formData); }
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
  const cart = await prisma.cart.findFirst({
    where: user ? { userId: user.id } : { sessionKey: key },
    include: { items: { where: { product: { type: { in: ["READY", "PARAMETRIC"] } } }, include: { product: { include: { ...productOptionInclude, images: { orderBy: { sortOrder: "asc" }, take: 1 }, categories: { include: { category: true } } } } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  if (!cart) return null;
  const stockReview = await legacyStockReviewProductIds(cart.items.flatMap(item => item.productId ? [item.productId] : []));
  const quantities = new Map<string | null, number>();
  for (const item of cart.items) quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
  return { ...cart, items: cart.items.map((item) => {
    const options = item.product ? productOptions(item.product) : null;
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
