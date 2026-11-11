"use server";

import { randomBytes } from "node:crypto";
import { redirect, unstable_rethrow } from "next/navigation";
import { getCart } from "@/app/actions/cart";
import { checkoutCart } from "@/lib/checkout-cart";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { checkoutSchema } from "@/lib/checkout-validation";
import { setGuestGrantCookie } from "@/lib/order-access";
import { createGuestGrant } from "@/lib/guest-order-grant";
import { reserveOrderFromCart } from "@/lib/cart-stock-holds";
import { assertCheckoutProductsUnchanged } from "@/lib/checkout-product-snapshot";
import { deliveryConfigFingerprint, getOzonDeliveryConfig, OZON_DELIVERY_CODE, requireOzonDelivery } from "@/lib/delivery/ozon-config";
import { cartDeliveryFingerprint, verifyOzonQuote, OzonQuoteError, type OzonQuote } from "@/lib/delivery/ozon-quote";
import { OzonDeliveryError } from "@/lib/delivery/ozon-client";
import { retryOzonQuote } from "@/lib/delivery/ozon-retry";
import { verifyDeliveryConsent, operatorReady } from "@/lib/privacy";
import { CONSENT_VERSION, PRIVACY_NOTICE_VERSION } from "@/lib/privacy-documents";
import { deliveryTotals } from "@/lib/delivery/pricing";
import { revalidatePath, updateTag } from "next/cache";
import { writeDiagnostic } from "@/lib/diagnostics";
import { ozonDiagnosticCode, type DiagnosticCode } from "@/lib/diagnostic-events";
import { ozonCreateBody } from "@/lib/delivery/ozon-worker";
import { queueTelegramOrder } from "@/lib/telegram/config";
import type { CheckoutActionState } from "@/lib/checkout-action-state";
import { CDEK_DELIVERY_CODE, getCdekConfig, requireCdek } from "@/lib/delivery/cdek-config";
import { cdekConfigFingerprint, cdekPackages, verifyCdekQuote, type CdekQuote } from "@/lib/delivery/cdek-quote";
import { CdekDeliveryClient } from "@/lib/delivery/cdek-client";
import { checkedCdekPoint } from "@/lib/delivery/cdek-points";
import { z } from "zod";
import { getYooKassaConfig, yookassaReady } from "@/lib/yookassa/config";
import { receiptForOrder } from "@/lib/yookassa/receipt";

async function submitOrder(formData: FormData, inline: boolean): Promise<CheckoutActionState> {
  const fail = (error: string, reference?: string, fields?: Record<string, string[]>) => {
    if (inline) return { error, reference, fields };
    redirect(`/checkout/?error=${error}${reference ? `&reference=${reference}` : ""}`);
  };
  if (!await operatorReady()) return fail("operator");
  const parsed = checkoutSchema.safeParse(Object.fromEntries(["name", "email", "phone", "city", "address", "postalCode", "delivery", "comment", "legal", "expectedTotal", "ozonQuote", "cdekQuote"].map((key) => [key, formData.get(key) ?? ""])));
  if (!parsed.success) { await writeDiagnostic("checkout.invalid"); return fail("invalid", undefined, parsed.error.flatten().fieldErrors); }
  const rawCart = await getCart();
  if (!rawCart?.items.length) redirect("/cart/?error=empty");
  const cart = checkoutCart(rawCart)!;
  if (!cart.items.length) {
    if (rawCart.items.some(item => item.canStartCheckout && item.stockReviewRequired && item.quote)) return fail("stock-review");
    redirect("/cart/?error=unavailable");
  }
  if (cart.items.some((item) => !item.canStartCheckout || !item.quote)) redirect("/cart/?error=unavailable");
  if (cart.items.some((item) => item.stockReviewRequired)) return fail("stock-review");
  // Do not silently add an item that became available after the form rendered,
  // or omit an item whose stock changed while the buyer was completing it.
  if (formData.get("cartFingerprint") !== cartDeliveryFingerprint(cart)) return fail("changed");
  const user = await getCurrentUser();
  const isOzon = parsed.data.delivery === OZON_DELIVERY_CODE;
  const isCdek = parsed.data.delivery === CDEK_DELIVERY_CODE;
  // The old fixed-price CDEK method treated delivery as free; it cannot bypass
  // the new carrier calculation or the buyer's explicit tariff selection.
  if (parsed.data.delivery === "cdek") return fail("delivery");
  let ozonQuote: OzonQuote | undefined;
  let cdekQuote: CdekQuote | undefined;
  if (isOzon) {
    let stage: "verify" | "consent" | "recheck" = "verify";
    const started = Date.now();
    let freshCost = 0;
    let attempts = 1;
    try {
      const config = await getOzonDeliveryConfig(); requireOzonDelivery(config);
      ozonQuote = verifyOzonQuote(parsed.data.ozonQuote, cart, config, parsed.data.phone);
      if (ozonQuote.consentId) {
        stage = "consent";
        await verifyDeliveryConsent(ozonQuote.consentId, cart.id, parsed.data.phone);
      }
      stage = "recheck";
      const result = await retryOzonQuote(config, api => api.checkout(ozonQuote!.request));
      const fresh = result.value; attempts = result.attempts;
      freshCost = fresh.cost;
    } catch (error) {
      let code: DiagnosticCode = stage === "consent" ? "delivery.consent" : "delivery.provider";
      let publicCode = stage === "consent" ? "ozon-consent" : "ozon-provider";
      if (error instanceof OzonQuoteError) { code = `delivery.quote.${error.reason}`; publicCode = `ozon-${error.reason}`; }
      else if (error instanceof OzonDeliveryError) { code = ozonDiagnosticCode(error.code); publicCode = ["transport", "recipient", "disabled", "credentials", "rate", "unavailable"].includes(error.code) ? `ozon-${error.code}` : "ozon-provider"; }
      const reference = await writeDiagnostic(code, { stage, durationMs: Date.now() - started, attempts: error instanceof OzonDeliveryError ? error.attempts : undefined,
        pointId: ozonQuote?.request.delivery?.delivery_point?.delivery_point_id,
        checkoutFailure: error instanceof OzonDeliveryError ? error.checkoutFailure : undefined,
        expectedParcels: error instanceof OzonDeliveryError ? error.expectedParcels : undefined, receivedParcels: error instanceof OzonDeliveryError ? error.receivedParcels : undefined });
      return fail(publicCode, reference ?? undefined);
    }
    if (Math.abs(freshCost - ozonQuote!.cost) > 0.005) {
      const reference = await writeDiagnostic("delivery.price", { stage: "recheck", carrierCostKopecks: Math.round(freshCost * 100), expectedCarrierCostKopecks: Math.round(ozonQuote!.cost * 100) });
      return fail("ozon-price", reference ?? undefined);
    }
    await writeDiagnostic("delivery.recheck.ok", { stage: "recheck", durationMs: Date.now() - started, attempts });
  }
  if (isCdek) {
    try {
      const config = await getCdekConfig(); requireCdek(config);
      cdekQuote = verifyCdekQuote(parsed.data.cdekQuote, cart, config);
      const api = new CdekDeliveryClient(config, config.environment);
      const packages = cdekPackages(cart);
      await checkedCdekPoint(api, cdekQuote.point, cdekQuote.cityCode, packages);
      await checkedCdekPoint(api, config.senderPoint, config.senderCityCode!, packages, "sender");
      const fresh = z.object({ total_sum: z.number().finite().nonnegative(), currency: z.literal("RUB"), errors: z.array(z.unknown()).optional() }).parse(await api.tariff({ type: 2, tariff_code: cdekQuote.tariff, from_location: { code: config.senderCityCode! }, to_location: { code: cdekQuote.cityCode }, shipment_point: config.senderPoint, delivery_point: cdekQuote.point, packages }));
      if (fresh.errors?.length || Math.abs(fresh.total_sum - cdekQuote.cost) > 0.005) throw new Error("price");
    } catch { return fail("cdek"); }
  }
  const deliveryMethod = isOzon ? { active: true, code: OZON_DELIVERY_CODE, name: "Ozon Доставка · ПВЗ", basePrice: ozonQuote!.cost } : isCdek ? { active: true, code: CDEK_DELIVERY_CODE, name: "СДЭК · ПВЗ", basePrice: cdekQuote!.cost } : await prisma.deliveryMethod.findFirst({ where: { code: parsed.data.delivery, active: true, deletedAt: null } });
  if (!deliveryMethod?.active) return fail("delivery");
  const subtotal = cart.items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const sums = deliveryTotals(subtotal, Number(deliveryMethod.basePrice));
  const carrierCost = sums.carrierCost;
  const deliveryPrice = isCdek ? carrierCost : sums.deliveryPrice;
  const total = Math.round((subtotal + deliveryPrice) * 100) / 100;
  if (Math.abs(total - parsed.data.expectedTotal) > 0.005) { await writeDiagnostic("checkout.price"); return fail("price"); }
  const paymentConfig = await getYooKassaConfig();
  const onlinePayment = yookassaReady(paymentConfig);
  if ((formData.get("paymentMode") === "online") !== onlinePayment) return fail("payment-changed");
  if (onlinePayment) {
    try { receiptForOrder({ customerEmail: parsed.data.email, total, deliveryPrice, items: cart.items.map(item => ({ productName: item.product!.name, quantity: item.quantity, unitPrice: item.unitPrice })) }, "full_prepayment"); }
    catch { return fail("payment-items"); }
  }
  const number = `3DP-${new Date().toISOString().slice(2, 10).replace(/-/g, "")}-${randomBytes(4).toString("hex").toUpperCase()}`;
  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      if (!isOzon && !isCdek) {
        // Serialize checkout with delivery deletion; stale forms cannot reuse removed methods.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412028)`;
        const current = await tx.deliveryMethod.findFirst({ where: { code: deliveryMethod.code, active: true, deletedAt: null } });
        if (!current || Number(current.basePrice) !== Number(deliveryMethod.basePrice)) throw new Error("delivery-config-changed");
      }
      let cdekRequest: object | undefined;
      let cdekConfig: Awaited<ReturnType<typeof getCdekConfig>> | undefined;
      if (cdekQuote) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412030)`;
        cdekConfig = await getCdekConfig(tx); requireCdek(cdekConfig);
        if (cdekConfigFingerprint(cdekConfig) !== cdekQuote.config) throw new Error("delivery-config-changed");
        verifyCdekQuote(parsed.data.cdekQuote, cart, cdekConfig);
        const contents = cart.items.flatMap(item => Array.from({ length: item.quantity }, () => item.product!.name.slice(0, 255)));
        cdekRequest = { type: 2, tariff_code: cdekQuote.tariff, shipment_point: cdekConfig.senderPoint, delivery_point: cdekQuote.point, sender: { company: cdekConfig.senderName, name: cdekConfig.senderName, phones: [{ number: cdekConfig.senderPhone }] }, recipient: { name: parsed.data.name, phones: [{ number: parsed.data.phone }], email: parsed.data.email }, packages: cdekPackages(cart).map((value, index) => ({ ...value, number: `${number}-${index + 1}`, comment: contents[index] })) };
      }
      if (ozonQuote) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412027)`;
        const config = await getOzonDeliveryConfig(tx); requireOzonDelivery(config);
        if (deliveryConfigFingerprint(config) !== ozonQuote.config) throw new Error("delivery-config-changed");
        if (ozonQuote.consentId) {
          await tx.$queryRaw`SELECT "id" FROM "PrivacyConsent" WHERE "id" = ${ozonQuote.consentId} FOR UPDATE`;
          await verifyDeliveryConsent(ozonQuote.consentId, cart.id, parsed.data.phone, tx);
        }
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412034)`;
      if (yookassaReady(await getYooKassaConfig(tx)) !== onlinePayment) throw new Error("payment-config-changed");
      const lines = cart.items.map(item => {
        if (!item.productId) throw new Error("stock-changed");
        return { productId: item.productId, quantity: item.quantity };
      });
      const reservation = await reserveOrderFromCart(tx, cart.id, lines);
      const reservedProducts = reservation.reserved;
      await assertCheckoutProductsUnchanged(tx, cart);
      const orderItems = cart.items.map(item => {
        const remaining = item.productId ? reservedProducts.get(item.productId) ?? 0 : 0;
        const held = Math.min(item.quantity, remaining);
        if (item.productId) reservedProducts.set(item.productId, remaining - held);
        return { productId: item.productId, variantId: item.quote!.variantId ?? item.variantId, productName: item.product!.name, groupLabel: item.product!.groupId ? item.product!.groupLabel || item.product!.sku : null, sku: item.product!.sku, quantity: item.quantity, reservedStock: held, stockReservationState: held ? "ACTIVE" : "NONE", unitPrice: item.unitPrice, totalPrice: item.unitPrice * item.quantity, configuration: item.quote!.config, materialId: item.quote!.materialId, colorId: item.quote!.colorId };
      });
      // Claim the cart rows atomically so a double click cannot create two orders.
      const claimed = await tx.cartItem.deleteMany({ where: { cartId: cart.id, OR: cart.items.map((item) => ({ id: item.id, quantity: item.quantity, updatedAt: item.updatedAt })) } });
      if (claimed.count !== cart.items.length) throw new Error("cart-changed");
      const created = await tx.order.create({ data: {
        number, userId: user?.id, inventoryTracked: true, reservationExpiresAt: onlinePayment ? reservation.expiresAt : null, checkoutCartId: onlinePayment ? cart.id : null, kind: onlinePayment ? "ORDER" : "APPLICATION", status: onlinePayment ? "AWAITING_PAYMENT" : "NEW", customerName: parsed.data.name, customerEmail: parsed.data.email, customerPhone: parsed.data.phone,
        shippingAddress: ozonQuote ? ozonQuote.address : cdekQuote ? cdekQuote.address : parsed.data.delivery === "pickup" ? "Самовывоз по согласованию" : `${parsed.data.postalCode ? `${parsed.data.postalCode}, ` : ""}${parsed.data.city}, ${parsed.data.address}`,
        customerComment: parsed.data.comment || undefined, subtotal, deliveryPrice, total,
        items: { create: orderItems },
        ...(onlinePayment ? { payment: { create: { provider: "yookassa-online", amount: total, status: "PENDING" } } } : {}),
        // Persist the carrier outbox atomically with the application. Retries
        // reuse this immutable body/key; no payment or receipt is created.
        shipment: { create: { provider: deliveryMethod.code, method: deliveryMethod.name, cost: carrierCost, ...(ozonQuote ? { payload: { pointId: ozonQuote.request.delivery.delivery_point.delivery_point_id, address: ozonQuote.address, estimatedDays: ozonQuote.days }, ozonJob: { create: { clientId: (await getOzonDeliveryConfig(tx)).clientId, request: ozonCreateBody(ozonQuote.request, number, parsed.data.name, cart.items.flatMap(item => Array.from({ length: item.quantity }, () => item.product!.name))) } } } : {}), ...(cdekQuote && cdekConfig && cdekRequest ? { payload: { pointId: cdekQuote.point, address: cdekQuote.address, tariff: cdekQuote.tariff, daysMin: cdekQuote.daysMin, daysMax: cdekQuote.daysMax }, cdekJob: { create: { clientId: cdekConfig.clientId, environment: cdekConfig.environment, request: JSON.parse(JSON.stringify(cdekRequest)) } } } : {}) } },
        notifications: { create: { channel: "email", recipient: parsed.data.email, template: "order-confirmation", status: "PENDING" } },
      } });
      await queueTelegramOrder(tx, created.id);
      await tx.auditLog.create({ data: { actorId: user?.id, action: "order.application.create", entityType: "Order", entityId: created.id, after: { version: CONSENT_VERSION, privacyNoticeVersion: PRIVACY_NOTICE_VERSION, delivery: deliveryMethod.code, flow: "contact-request" } } });
      if (ozonQuote?.consentId) await tx.privacyConsent.update({ where: { id: ozonQuote.consentId }, data: { orderId: created.id } });
      const guestGrant = user ? undefined : await createGuestGrant(tx, created.number);
      return { order: created, guestGrant };
    });
  } catch (error) {
    await writeDiagnostic("checkout.changed");
    if (error instanceof Error && error.message === "stock-legacy-review") return fail("stock-review");
    if (inline) return fail("changed");
    redirect("/cart/?error=changed");
  }
  await writeDiagnostic("checkout.application");
  const { order, guestGrant } = result;
  if (guestGrant) await setGuestGrantCookie(order.number, guestGrant);
  updateTag("catalog");
  const { sendOrderConfirmation } = await import("@/lib/order-notifications");
  await sendOrderConfirmation(order.id).catch(() => undefined);
  revalidatePath("/admin", "layout");
  revalidatePath("/account", "layout");
  revalidatePath("/", "layout");
  if (onlinePayment) {
    try {
      const { createYooKassaPayment } = await import("@/lib/yookassa/payments");
      const url = await createYooKassaPayment(order.id, { customerAttempt: true });
      if (url) redirect(url);
    } catch (error) { unstable_rethrow(error); }
  }
  redirect(`/checkout/success/${order.number}/`);
}

// Keep the progressive-enhancement/HTTP interface while the hydrated form
// receives expected failures as state, never as a destructive navigation.
export async function createOrderAction(formData: FormData) { await submitOrder(formData, false); }
export async function createOrderWithState(_previous: CheckoutActionState, formData: FormData) {
  try { return await submitOrder(formData, true); }
  catch (error) { unstable_rethrow(error); await writeDiagnostic("server.failed"); return { error: "temporary" }; }
}
