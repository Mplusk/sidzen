"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { encryptSecret } from "@/lib/integration-secrets";
import { getCart } from "@/app/actions/cart";
import { normalizePhone } from "@/lib/checkout-validation";
import { OzonDeliveryClient, OzonDeliveryError, positiveId } from "@/lib/delivery/ozon-client";
import { deliveryConfigFingerprint, getOzonDeliveryConfig, OZON_DELIVERY_SETTING, ozonDeliveryConfigSchema, requireOzonDelivery } from "@/lib/delivery/ozon-config";
import { buildOzonPostings, cartDeliveryFingerprint, signOzonQuote } from "@/lib/delivery/ozon-quote";
import { retryOzonQuote } from "@/lib/delivery/ozon-retry";
import { consentDocument, privacySubject, operatorReady } from "@/lib/privacy";
import { CONSENT_VERSION } from "@/lib/privacy-documents";
import { getCurrentUser } from "@/lib/auth";
import { customerDeliveryPrice } from "@/lib/delivery/pricing";
import { writeDiagnostic } from "@/lib/diagnostics";
import { ozonDiagnosticCode } from "@/lib/diagnostic-events";

function finish(code: string): never { redirect(`/account/integrations/?result=${code}#ozon-delivery`); }
export async function saveOzonDelivery(form: FormData) {
  const user = await requirePermission("settings.write");
  if (!rateLimit(`ozon-settings:${user.id}`, 10, 60000).allowed) finish("rate");
  const current = await getOzonDeliveryConfig();
  const parsed = ozonDeliveryConfigSchema.safeParse({ enabled: form.get("enabled") === "on", clientId: String(form.get("clientId") ?? "").trim(), clientSecret: String(form.get("clientSecret") ?? "").trim() || current.clientSecret, shipmentMethodId: form.get("shipmentMethodId") ? Number(form.get("shipmentMethodId")) : null, dispatchDays: Number(form.get("dispatchDays")) });
  if (!parsed.success) finish("ozon-invalid");
  const config = parsed.data;
  let changed = config.clientId !== current.clientId || config.clientSecret !== current.clientSecret || config.shipmentMethodId !== current.shipmentMethodId;
  if (config.enabled && (!config.clientId || !config.clientSecret)) finish("ozon-incomplete");
  if (config.enabled || changed || form.get("intent") === "check" || form.get("intent") === "methods") {
    try {
      const api = new OzonDeliveryClient(config);
      config.methods = await api.shipmentMethods();
      config.authorizedAt = new Date().toISOString();
      const active = config.methods.filter(method => method.status === "active");
      // A single active method is unambiguous. Never guess between several routes.
      if (!config.shipmentMethodId && active.length === 1) config.shipmentMethodId = active[0].shipment_method_id;
      await api.pointPage(null); // Verify PVZ permission too; no order creation.
      if (config.shipmentMethodId) {
        const method = await api.verifyMethod(config.shipmentMethodId);
        config.methodName = method.name; config.checkedAt = new Date().toISOString();
      } else {
        config.enabled = false;
      }
      changed = config.clientId !== current.clientId || config.clientSecret !== current.clientSecret || config.shipmentMethodId !== current.shipmentMethodId;
    } catch (error) { await writeDiagnostic(ozonDiagnosticCode(error instanceof OzonDeliveryError ? error.code : "response")); finish("ozon-connection"); }
  } else { config.checkedAt = current.checkedAt; config.methodName = current.methodName; config.authorizedAt = current.authorizedAt; config.methods = current.methods; }
  const saved = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412027)`;
    if (JSON.stringify(await getOzonDeliveryConfig(tx)) !== JSON.stringify(current)) return false;
    if (config.clientId !== current.clientId && await tx.ozonDeliveryJob.count({ where: { status: { notIn: ["FINISHED", "CANCELED"] } } })) return false;
    const value = JSON.parse(JSON.stringify({ ...config, clientSecret: config.clientSecret ? encryptSecret(config.clientSecret, OZON_DELIVERY_SETTING) : "" }));
    await tx.siteSetting.upsert({ where: { key: OZON_DELIVERY_SETTING }, create: { key: OZON_DELIVERY_SETTING, group: "integrations", value }, update: { value, group: "integrations" } });
    if (config.enabled && (changed || form.get("intent") === "points" || !await tx.ozonDeliverySync.findUnique({ where: { id: "ozon" } }))) {
      const data = { clientId: config.clientId, methodId: BigInt(config.shipmentMethodId!), generation: randomUUID(), cursor: null, pages: 0, points: 0, error: null, status: "PENDING", lockedUntil: null, lockToken: null };
      await tx.ozonDeliverySync.upsert({ where: { id: "ozon" }, create: { id: "ozon", ...data }, update: data });
    }
    await tx.auditLog.create({ data: { actorId: user.id, action: "integration.ozon-delivery.update", entityType: "SiteSetting", after: { enabled: config.enabled, clientId: config.clientId, shipmentMethodId: config.shipmentMethodId, changed } } });
    return true;
  });
  if (!saved) finish("ozon-pending");
  revalidatePath("/account/integrations/"); revalidatePath("/checkout/");
  finish(config.authorizedAt && !config.shipmentMethodId ? config.methods?.some(method => method.status === "active") ? "ozon-select-method" : "ozon-no-method" : config.checkedAt ? "ozon-verified" : "saved");
}

export async function quoteOzonDelivery(phoneInput: string, pointInput: string, consentAccepted: boolean = false) {
  // This check must precede even OAuth / point-info calls, not just the UI button.
  if (consentAccepted !== true) return { error: "Для передачи номера Ozon необходимо отдельное согласие на расчёт доставки." };
  if (!await operatorReady()) return { error: "Для расчёта нужны сведения оператора и подтверждение размещения базы данных в России. Расчёт временно недоступен." };
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0] || "unknown";
  if (!rateLimit(`ozon-quote:${ip}`, 15, 60000).allowed) return { error: "Слишком много расчётов. Повторите через минуту." };
  const started = Date.now();
  let selectedPointId: number | undefined;
  try {
    const phone = normalizePhone(phoneInput); const id = positiveId.parse(Number(pointInput));
    if (!/^\+7\d{10}$/.test(phone)) throw new OzonDeliveryError("recipient");
    const [cart, config] = await Promise.all([getCart(), getOzonDeliveryConfig()]);
    requireOzonDelivery(config);
    if (!cart?.items.length || cart.items.some(item => !item.available)) throw new OzonDeliveryError("cart");
    const request = { recipient: { phone_number: phone }, delivery: { delivery_point: { delivery_point_id: id } }, postings: buildOzonPostings(cart.items, config) };
    const user = await getCurrentUser();
    const consent = await prisma.privacyConsent.create({ data: { userId: user?.id, subjectHash: privacySubject(cart.id, phone), purpose: "ozon", version: CONSENT_VERSION, document: await consentDocument("ozon"), expiresAt: new Date(Date.now() + 15 * 60000) } });
    const { value: { point, calculation }, attempts } = await retryOzonQuote(config, async api => {
      const point = (await api.pointInfo([id])).find(point => point.delivery_point_id === id && point.is_active);
      if (!point) throw new OzonDeliveryError("point");
      selectedPointId = id;
      return { point, calculation: await api.checkout(request) };
    });
    await writeDiagnostic("delivery.quote.ok", { stage: "quote", durationMs: Date.now() - started, attempts, pointId: selectedPointId, expectedParcels: request.postings.length });
    return { ...calculation, cost: customerDeliveryPrice(), address: point.full_address, token: signOzonQuote({ ...calculation, consentId: consent.id, address: point.full_address, request, cart: cartDeliveryFingerprint(cart), config: deliveryConfigFingerprint(config), expires: consent.expiresAt!.getTime() }) };
  } catch (error) {
    const code = error instanceof OzonDeliveryError ? error.code : "provider";
    const reference = await writeDiagnostic(ozonDiagnosticCode(code), { stage: "quote", durationMs: Date.now() - started, reason: code, attempts: error instanceof OzonDeliveryError ? error.attempts : undefined,
      pointId: selectedPointId, checkoutFailure: error instanceof OzonDeliveryError ? error.checkoutFailure : undefined,
      expectedParcels: error instanceof OzonDeliveryError ? error.expectedParcels : undefined, receivedParcels: error instanceof OzonDeliveryError ? error.receivedParcels : undefined });
    const message = code === "packaging" ? "Для товаров не заполнены параметры упаковки. Выберите другую доставку или свяжитесь с магазином." : code === "recipient" ? "Ozon Доставка доступна для номера телефона, зарегистрированного на Ozon. Проверьте номер или выберите другую доставку." : code === "parcels" ? "Для Ozon Доставки можно оформить не более 100 отдельных посылок." : code === "transport" ? "Ozon не ответил на проверку доставки. Повторите попытку чуть позже." : "Не удалось рассчитать доставку. Проверьте выбранный ПВЗ или выберите другой способ.";
    const precise = error instanceof OzonDeliveryError && error.checkoutFailure === "point-restrictions" ? "Ozon сообщил об ограничениях выбранного ПВЗ для этой посылки. Выберите другой ПВЗ или свяжитесь с магазином." : error instanceof OzonDeliveryError && ["empty-results", "partial-results", "missing-posting"].includes(error.checkoutFailure ?? "") ? "Ozon не вернул полный расчёт доставки после автоматических повторов. Выбранный ПВЗ сохранён — попробуйте позже или выберите другой пункт." : message;
    return { error: `${precise}${reference ? ` Код обращения: ${reference}` : ""}` };
  }
}
