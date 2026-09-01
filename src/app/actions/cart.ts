"use server";

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { calculatePrintQuote } from "@/lib/pricing";

const CART_COOKIE = "3dp_cart";

export async function getOrCreateCart() {
  const user = await getCurrentUser();
  if (user) {
    const cart = await prisma.cart.findUnique({ where: { userId: user.id } });
    return cart ?? prisma.cart.create({ data: { userId: user.id } });
  }
  const cookieStore = await cookies();
  let key = cookieStore.get(CART_COOKIE)?.value;
  if (!key) {
    key = randomBytes(24).toString("base64url");
    cookieStore.set(CART_COOKIE, key, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 30, path: "/" });
  }
  const cart = await prisma.cart.findUnique({ where: { sessionKey: key } });
  return cart ?? prisma.cart.create({ data: { sessionKey: key } });
}

export async function addModelToCart(formData: FormData) {
  const modelFileId = String(formData.get("modelFileId") ?? "");
  const materialSlug = String(formData.get("material") ?? "pla");
  const qualitySlug = String(formData.get("quality") ?? "standard");
  const infillPercent = Math.max(10, Math.min(100, Number(formData.get("infill")) || 20));
  const quantity = Math.max(1, Math.min(999, Number(formData.get("quantity")) || 1));
  const scale = Math.max(0.1, Math.min(5, Number(formData.get("scale")) || 1));
  const postProcessingSlug = String(formData.get("postProcessing") ?? "support-removal");
  const user = await getCurrentUser();
  const cookieStore = await cookies();
  const guestKey = cookieStore.get("3dp_file_owner")?.value;
  const model = await prisma.customerModelFile.findFirst({ where: { id: modelFileId, ...(user ? { ownerId: user.id } : { guestKey }) } });
  if (!model) redirect("/print/?error=file-access");
  const [material, quality, postProcessing, minimumRule, setupRule] = await Promise.all([
    prisma.material.findUnique({ where: { slug: materialSlug } }),
    prisma.qualityProfile.findUnique({ where: { slug: qualitySlug } }),
    prisma.postProcessOption.findUnique({ where: { slug: postProcessingSlug } }),
    prisma.priceRule.findUnique({ where: { code: "minimum_order" } }),
    prisma.priceRule.findUnique({ where: { code: "setup_fee" } }),
  ]);
  if (!material || !quality || !postProcessing) redirect("/print/?error=invalid-configuration");
  const quote = calculatePrintQuote({
    volumeCm3: Number(model.volumeCm3) || estimateBoundingVolume(model) * 0.28,
    densityGcm3: Number(material.density),
    materialPricePerGram: Number(material.pricePerGram),
    infillPercent,
    qualityMultiplier: Number(quality.priceMultiplier),
    postProcessingPrice: Number(postProcessing.price),
    quantity,
    minimumOrder: Number(minimumRule?.value) || 650,
    setupFee: Number(setupRule?.value) || 250,
    scale,
  });
  const cart = await getOrCreateCart();
  await prisma.cartItem.create({
    data: {
      cartId: cart.id,
      modelFileId: model.id,
      quantity,
      unitPrice: quote.total / quantity,
      config: { material: material.slug, color: String(formData.get("color") ?? ""), quality: quality.slug, infillPercent, scale, postProcessing: postProcessing.slug, quote },
    },
  });
  redirect("/cart/");
}

function estimateBoundingVolume(model: { widthMm: unknown; heightMm: unknown; depthMm: unknown }) {
  return (Number(model.widthMm) * Number(model.heightMm) * Number(model.depthMm)) / 1000;
}

export async function addProductToCart(formData: FormData) {
  const productId = String(formData.get("productId") ?? "");
  const quantity = Math.max(1, Math.min(999, Number(formData.get("quantity")) || 1));
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product || product.status !== "PUBLISHED") redirect("/catalog/?error=product-unavailable");
  const cart = await getOrCreateCart();
  const config = {
    material: String(formData.get("material") ?? ""),
    color: String(formData.get("color") ?? ""),
    quality: String(formData.get("quality") ?? ""),
  };
  await prisma.cartItem.create({ data: { cartId: cart.id, productId: product.id, quantity, unitPrice: product.basePrice, config } });
  redirect("/cart/");
}

export async function removeCartItem(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const cart = await getOrCreateCart();
  await prisma.cartItem.deleteMany({ where: { id, cartId: cart.id } });
  redirect("/cart/");
}

export async function getCart() {
  const user = await getCurrentUser();
  const key = (await cookies()).get(CART_COOKIE)?.value;
  if (!user && !key) return null;
  return prisma.cart.findFirst({
    where: user ? { userId: user.id } : { sessionKey: key },
    include: { items: { include: { product: { include: { images: { orderBy: { sortOrder: "asc" }, take: 1 }, categories: { include: { category: true } } } }, modelFile: true } } },
  });
}
