"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { getCart } from "@/app/actions/cart";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const checkoutSchema = z.object({ name: z.string().trim().min(2).max(120), email: z.email(), phone: z.string().trim().min(7).max(30), city: z.string().trim().min(2).max(120), address: z.string().trim().min(4).max(300), postalCode: z.string().trim().max(12), delivery: z.string().trim().min(1), comment: z.string().trim().max(1000), legal: z.literal("on") });

export async function createOrderAction(formData: FormData) {
  const parsed = checkoutSchema.safeParse({ name: formData.get("name"), email: formData.get("email"), phone: formData.get("phone"), city: formData.get("city"), address: formData.get("address"), postalCode: formData.get("postalCode") ?? "", delivery: formData.get("delivery"), comment: formData.get("comment") ?? "", legal: formData.get("legal") });
  if (!parsed.success) redirect("/checkout/?error=invalid");
  const cart = await getCart();
  if (!cart?.items.length) redirect("/cart/?error=empty");
  const user = await getCurrentUser();
  const deliveryMethod = await prisma.deliveryMethod.findUnique({ where: { code: parsed.data.delivery } });
  if (!deliveryMethod?.active) redirect("/checkout/?error=delivery");
  const subtotal = cart.items.reduce((sum, item) => sum + Number(item.unitPrice) * item.quantity, 0);
  const deliveryPrice = Number(deliveryMethod.basePrice);
  const total = subtotal + deliveryPrice;
  const number = `3DP-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${randomBytes(3).toString("hex").toUpperCase()}`;
  const order = await prisma.$transaction(async (tx) => {
    const created = await tx.order.create({
      data: {
        number,
        userId: user?.id,
        customerName: parsed.data.name,
        customerEmail: parsed.data.email.toLowerCase(),
        customerPhone: parsed.data.phone,
        shippingAddress: `${parsed.data.postalCode ? `${parsed.data.postalCode}, ` : ""}${parsed.data.city}, ${parsed.data.address}`,
        customerComment: parsed.data.comment || undefined,
        subtotal,
        deliveryPrice,
        total,
        items: {
          create: cart.items.map((item) => {
            const config = (item.config ?? {}) as Prisma.InputJsonValue;
            return { productId: item.productId, modelFileId: item.modelFileId, productName: item.product?.name ?? `Печать модели ${item.modelFile?.originalName ?? "клиента"}`, sku: item.product?.sku, quantity: item.quantity, unitPrice: item.unitPrice, totalPrice: Number(item.unitPrice) * item.quantity, configuration: config };
          }),
        },
        payment: { create: { provider: process.env.PAYMENT_PROVIDER ?? "manual", amount: total, status: "PENDING" } },
        shipment: { create: { provider: deliveryMethod.code, method: deliveryMethod.name, cost: deliveryPrice } },
      },
    });
    await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
    return created;
  });
  redirect(`/checkout/success/${order.number}/`);
}
