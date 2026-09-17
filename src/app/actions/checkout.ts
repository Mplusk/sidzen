"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { getCart } from "@/app/actions/cart";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkoutSchema } from "@/lib/checkout-validation";
import { grantOrderAccess } from "@/lib/order-access";
import { createOnlinePayment, onlinePaymentReady } from "@/lib/payments";
import { getPaymentConfig } from "@/lib/integrations";

export async function createOrderAction(formData: FormData) {
  const parsed = checkoutSchema.safeParse(Object.fromEntries(["name", "email", "phone", "city", "address", "postalCode", "delivery", "comment", "legal", "payment", "expectedTotal"].map((key) => [key, formData.get(key) ?? ""])));
  if (!parsed.success) redirect("/checkout/?error=invalid");
  if (parsed.data.payment === "yookassa" && !await onlinePaymentReady()) redirect("/checkout/?error=payment");
  const cart = await getCart();
  if (!cart?.items.length) redirect("/cart/?error=empty");
  if (cart.items.some((item) => !item.available || !item.quote)) redirect("/cart/?error=unavailable");
  const user = await getCurrentUser();
  const deliveryMethod = await prisma.deliveryMethod.findUnique({ where: { code: parsed.data.delivery } });
  if (!deliveryMethod?.active) redirect("/checkout/?error=delivery");
  const subtotal = cart.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const deliveryPrice = Number(deliveryMethod.basePrice);
  const total = Math.round((subtotal + deliveryPrice) * 100) / 100;
  if (Math.abs(total - parsed.data.expectedTotal) > 0.005) redirect("/checkout/?error=price");
  const number = `3DP-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${randomBytes(4).toString("hex").toUpperCase()}`;
  let order;
  try {
    order = await prisma.$transaction(async (tx) => {
      if (parsed.data.payment === "yookassa") {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412026)`;
        const config = await getPaymentConfig(tx);
        if (!config.enabled || !config.shopId || !config.secret) throw new Error("payment-config-changed");
      }
      // Claim the cart rows atomically so a double click cannot create two orders.
      const claimed = await tx.cartItem.deleteMany({ where: { cartId: cart.id, OR: cart.items.map((item) => ({ id: item.id, quantity: item.quantity, updatedAt: item.updatedAt })) } });
      if (claimed.count !== cart.items.length) throw new Error("cart-changed");
      return tx.order.create({ data: {
        number, userId: user?.id, status: "AWAITING_PAYMENT", customerName: parsed.data.name, customerEmail: parsed.data.email, customerPhone: parsed.data.phone,
        shippingAddress: parsed.data.delivery === "pickup" ? "Самовывоз по согласованию" : `${parsed.data.postalCode ? `${parsed.data.postalCode}, ` : ""}${parsed.data.city}, ${parsed.data.address}`,
        customerComment: parsed.data.comment || undefined, subtotal, deliveryPrice, total,
        items: { create: cart.items.map((item) => ({ productId: item.productId, productName: item.product!.name, sku: item.product!.sku, quantity: item.quantity, unitPrice: item.unitPrice, totalPrice: item.unitPrice * item.quantity, configuration: item.quote!.config, materialId: item.quote!.materialId, colorId: item.quote!.colorId, qualityProfileId: item.quote!.qualityProfileId })) },
        payment: { create: { provider: parsed.data.payment, amount: total, status: "PENDING" } },
        shipment: { create: { provider: deliveryMethod.code, method: deliveryMethod.name, cost: deliveryPrice } },
        notifications: { create: { channel: "email", recipient: parsed.data.email, template: "order-confirmation", status: "PENDING" } },
      } });
    });
  } catch {
    redirect("/cart/?error=changed");
  }
  await grantOrderAccess(order.number);
  const { sendOrderConfirmation } = await import("@/lib/order-notifications");
  await sendOrderConfirmation(order.id).catch(() => undefined);
  let paymentUrl: string | null = null;
  if (parsed.data.payment === "yookassa") {
    try { paymentUrl = await createOnlinePayment(order.id); } catch { redirect(`/checkout/success/${order.number}/?error=payment`); }
  }
  redirect(paymentUrl ?? `/checkout/success/${order.number}/`);
}
