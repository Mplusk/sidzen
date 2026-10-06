"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { getCart } from "@/app/actions/cart";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkoutSchema } from "@/lib/checkout-validation";
import { grantOrderAccess } from "@/lib/order-access";
import { deliveryConfigFingerprint, getOzonDeliveryConfig, OZON_DELIVERY_CODE, requireOzonDelivery } from "@/lib/delivery/ozon-config";
import { verifyOzonQuote, OzonQuoteError, type OzonQuote } from "@/lib/delivery/ozon-quote";
import { OzonDeliveryError } from "@/lib/delivery/ozon-client";
import { retryOzonQuote } from "@/lib/delivery/ozon-retry";
import { verifyDeliveryConsent, operatorReady } from "@/lib/privacy";
import { CONSENT_VERSION } from "@/lib/privacy-documents";
import { deliveryTotals } from "@/lib/delivery/pricing";
import { revalidatePath } from "next/cache";
import { writeDiagnostic } from "@/lib/diagnostics";
import { ozonDiagnosticCode, type DiagnosticCode } from "@/lib/diagnostic-events";

export async function createOrderAction(formData: FormData) {
  if (!await operatorReady()) redirect("/checkout/?error=operator");
  const parsed = checkoutSchema.safeParse(Object.fromEntries(["name", "email", "phone", "city", "address", "postalCode", "delivery", "comment", "legal", "expectedTotal", "ozonQuote", "ozonConsent"].map((key) => [key, formData.get(key) ?? ""])));
  if (!parsed.success) { await writeDiagnostic("checkout.invalid"); redirect("/checkout/?error=invalid"); }
  const cart = await getCart();
  if (!cart?.items.length) redirect("/cart/?error=empty");
  if (cart.items.some((item) => !item.available || !item.quote)) redirect("/cart/?error=unavailable");
  const user = await getCurrentUser();
  const isOzon = parsed.data.delivery === OZON_DELIVERY_CODE;
  let ozonQuote: OzonQuote | undefined;
  if (isOzon) {
    let stage: "verify" | "consent" | "recheck" = "verify";
    const started = Date.now();
    let freshCost = 0;
    let attempts = 1;
    try {
      const config = await getOzonDeliveryConfig(); requireOzonDelivery(config);
      ozonQuote = verifyOzonQuote(parsed.data.ozonQuote, cart, config, parsed.data.phone);
      stage = "consent";
      await verifyDeliveryConsent(ozonQuote.consentId ?? "", cart.id, parsed.data.phone);
      stage = "recheck";
      const result = await retryOzonQuote(config, api => api.checkout(ozonQuote!.request));
      const fresh = result.value; attempts = result.attempts;
      freshCost = fresh.cost;
    } catch (error) {
      let code: DiagnosticCode = stage === "consent" ? "delivery.consent" : "delivery.provider";
      let publicCode = stage === "consent" ? "ozon-consent" : "ozon-provider";
      if (error instanceof OzonQuoteError) { code = `delivery.quote.${error.reason}`; publicCode = `ozon-${error.reason}`; }
      else if (error instanceof OzonDeliveryError) { code = ozonDiagnosticCode(error.code); publicCode = ["transport", "recipient", "disabled", "credentials", "rate", "unavailable"].includes(error.code) ? `ozon-${error.code}` : "ozon-provider"; }
      const reference = await writeDiagnostic(code, { stage, durationMs: Date.now() - started, attempts: error instanceof OzonDeliveryError ? error.attempts : undefined });
      redirect(`/checkout/?error=${publicCode}${reference ? `&reference=${reference}` : ""}`);
    }
    if (Math.abs(freshCost - ozonQuote!.cost) > 0.005) {
      const reference = await writeDiagnostic("delivery.price", { stage: "recheck", carrierCostKopecks: Math.round(freshCost * 100), expectedCarrierCostKopecks: Math.round(ozonQuote!.cost * 100) });
      redirect(`/checkout/?error=ozon-price${reference ? `&reference=${reference}` : ""}`);
    }
    await writeDiagnostic("delivery.recheck.ok", { stage: "recheck", durationMs: Date.now() - started, attempts });
  }
  const deliveryMethod = isOzon ? { active: true, code: OZON_DELIVERY_CODE, name: "Ozon Доставка · ПВЗ", basePrice: ozonQuote!.cost } : await prisma.deliveryMethod.findFirst({ where: { code: parsed.data.delivery, active: true, deletedAt: null } });
  if (!deliveryMethod?.active) redirect("/checkout/?error=delivery");
  const subtotal = cart.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const { deliveryPrice, carrierCost, total } = deliveryTotals(subtotal, Number(deliveryMethod.basePrice));
  if (Math.abs(total - parsed.data.expectedTotal) > 0.005) { await writeDiagnostic("checkout.price"); redirect("/checkout/?error=price"); }
  const number = `3DP-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${randomBytes(4).toString("hex").toUpperCase()}`;
  let order;
  try {
    order = await prisma.$transaction(async (tx) => {
      if (!isOzon) {
        // Serialize checkout with delivery deletion; stale forms cannot reuse removed methods.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412028)`;
        const current = await tx.deliveryMethod.findFirst({ where: { code: deliveryMethod.code, active: true, deletedAt: null } });
        if (!current || Number(current.basePrice) !== Number(deliveryMethod.basePrice)) throw new Error("delivery-config-changed");
      }
      if (ozonQuote) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412027)`;
        const config = await getOzonDeliveryConfig(tx); requireOzonDelivery(config);
        if (deliveryConfigFingerprint(config) !== ozonQuote.config) throw new Error("delivery-config-changed");
        await tx.$queryRaw`SELECT "id" FROM "PrivacyConsent" WHERE "id" = ${ozonQuote.consentId ?? ""} FOR UPDATE`;
        await verifyDeliveryConsent(ozonQuote.consentId ?? "", cart.id, parsed.data.phone, tx);
      }
      // Claim the cart rows atomically so a double click cannot create two orders.
      const claimed = await tx.cartItem.deleteMany({ where: { cartId: cart.id, OR: cart.items.map((item) => ({ id: item.id, quantity: item.quantity, updatedAt: item.updatedAt })) } });
      if (claimed.count !== cart.items.length) throw new Error("cart-changed");
      const created = await tx.order.create({ data: {
        number, userId: user?.id, kind: "APPLICATION", status: "NEW", customerName: parsed.data.name, customerEmail: parsed.data.email, customerPhone: parsed.data.phone,
        shippingAddress: ozonQuote ? ozonQuote.address : parsed.data.delivery === "pickup" ? "Самовывоз по согласованию" : `${parsed.data.postalCode ? `${parsed.data.postalCode}, ` : ""}${parsed.data.city}, ${parsed.data.address}`,
        customerComment: parsed.data.comment || undefined, subtotal, deliveryPrice, total,
        items: { create: cart.items.map((item) => ({ productId: item.productId, productName: item.product!.name, sku: item.product!.sku, quantity: item.quantity, unitPrice: item.unitPrice, totalPrice: item.unitPrice * item.quantity, configuration: item.quote!.config, materialId: item.quote!.materialId, colorId: item.quote!.colorId, qualityProfileId: item.quote!.qualityProfileId })) },
        // A preference, not an instruction to a carrier. No payment, fiscal
        // receipt or delivery job may be created by submitting an application.
        shipment: { create: { provider: deliveryMethod.code, method: deliveryMethod.name, cost: carrierCost, ...(ozonQuote ? { payload: { pointId: ozonQuote.request.delivery.delivery_point.delivery_point_id, address: ozonQuote.address, estimatedDays: ozonQuote.days } } : {}) } },
        notifications: { create: { channel: "email", recipient: parsed.data.email, template: "order-confirmation", status: "PENDING" } },
      } });
      await tx.auditLog.create({ data: { actorId: user?.id, action: "order.application.create", entityType: "Order", entityId: created.id, after: { version: CONSENT_VERSION, privacyNoticeVersion: CONSENT_VERSION, delivery: deliveryMethod.code, flow: "contact-request" } } });
      if (ozonQuote?.consentId) await tx.privacyConsent.update({ where: { id: ozonQuote.consentId }, data: { orderId: created.id } });
      return created;
    });
  } catch {
    await writeDiagnostic("checkout.changed");
    redirect("/cart/?error=changed");
  }
  await writeDiagnostic("checkout.application");
  if (!user) await grantOrderAccess(order.number);
  const { sendOrderConfirmation } = await import("@/lib/order-notifications");
  await sendOrderConfirmation(order.id).catch(() => undefined);
  revalidatePath("/admin", "layout");
  revalidatePath("/account", "layout");
  redirect(`/checkout/success/${order.number}/`);
}
