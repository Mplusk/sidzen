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

function finish(code: string): never { redirect(`/account/integrations/?result=${code}#ozon-delivery`); }
export async function saveOzonDelivery(form: FormData) {
  const user = await requirePermission("settings.write");
  if (!rateLimit(`ozon-settings:${user.id}`, 10, 60000).allowed) finish("rate");
  const current = await getOzonDeliveryConfig();
  const parsed = ozonDeliveryConfigSchema.safeParse({ enabled: form.get("enabled") === "on", clientId: String(form.get("clientId") ?? "").trim(), clientSecret: String(form.get("clientSecret") ?? "").trim() || current.clientSecret, shipmentMethodId: form.get("shipmentMethodId") ? Number(form.get("shipmentMethodId")) : null, dispatchDays: Number(form.get("dispatchDays")) });
  if (!parsed.success) finish("ozon-invalid");
  const config = parsed.data;
  const changed = config.clientId !== current.clientId || config.clientSecret !== current.clientSecret || config.shipmentMethodId !== current.shipmentMethodId;
  if (config.enabled && (!config.clientId || !config.clientSecret || !config.shipmentMethodId)) finish("ozon-incomplete");
  if (config.enabled || changed || form.get("intent") === "check") {
    try {
      if (!config.shipmentMethodId) throw new OzonDeliveryError("method");
      const api = new OzonDeliveryClient(config);
      const method = await api.verifyMethod(config.shipmentMethodId);
      await api.pointPage(null); // Verify PVZ permission too; no order creation.
      config.methodName = method.name; config.checkedAt = new Date().toISOString();
    } catch { finish("ozon-connection"); }
  } else { config.checkedAt = current.checkedAt; config.methodName = current.methodName; }
  const saved = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412027)`;
    if (JSON.stringify(await getOzonDeliveryConfig(tx)) !== JSON.stringify(current)) return false;
    if (config.clientId !== current.clientId && await tx.ozonDeliveryJob.count({ where: { status: { notIn: ["FINISHED", "CANCELED"] } } })) return false;
    const value = { ...config, clientSecret: config.clientSecret ? encryptSecret(config.clientSecret, OZON_DELIVERY_SETTING) : "" };
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
  finish(config.checkedAt ? "ozon-verified" : "saved");
}

export async function quoteOzonDelivery(phoneInput: string, pointInput: string) {
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0] || "unknown";
  if (!rateLimit(`ozon-quote:${ip}`, 15, 60000).allowed) return { error: "Слишком много расчётов. Повторите через минуту." };
  try {
    const phone = normalizePhone(phoneInput); const id = positiveId.parse(Number(pointInput));
    if (!/^\+7\d{10}$/.test(phone)) throw new OzonDeliveryError("recipient");
    const [cart, config] = await Promise.all([getCart(), getOzonDeliveryConfig()]);
    requireOzonDelivery(config);
    if (!cart?.items.length || cart.items.some(item => !item.available)) throw new OzonDeliveryError("cart");
    const api = new OzonDeliveryClient(config);
    const point = (await api.pointInfo([id])).find(point => point.delivery_point_id === id && point.is_active);
    if (!point) throw new OzonDeliveryError("point");
    const request = { recipient: { phone_number: phone }, delivery: { delivery_point: { delivery_point_id: id } }, postings: buildOzonPostings(cart.items, config) };
    const calculation = await api.checkout(request);
    return { ...calculation, address: point.full_address, token: signOzonQuote({ ...calculation, address: point.full_address, request, cart: cartDeliveryFingerprint(cart), config: deliveryConfigFingerprint(config), expires: Date.now() + 15 * 60000 }) };
  } catch (error) {
    const code = error instanceof OzonDeliveryError ? error.code : "provider";
    return { error: code === "packaging" ? "Для товаров не заполнены параметры упаковки. Выберите другую доставку или свяжитесь с магазином." : code === "recipient" ? "Ozon Доставка доступна для номера телефона, зарегистрированного на Ozon. Проверьте номер или выберите другую доставку." : code === "parcels" ? "Для Ozon Доставки можно оформить не более 100 отдельных посылок." : "Не удалось рассчитать доставку. Проверьте выбранный ПВЗ или выберите другой способ." };
  }
}
