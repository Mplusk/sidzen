"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { encryptSecret } from "@/lib/integration-secrets";
import { rateLimit } from "@/lib/rate-limit";
import { CdekDeliveryClient } from "@/lib/delivery/cdek-client";
import { CDEK_SETTING, cdekConfigSchema, getCdekConfig } from "@/lib/delivery/cdek-config";
import { normalizePhone } from "@/lib/checkout-validation";
import { z } from "zod";
import { headers } from "next/headers";
import { getCart } from "@/app/actions/cart";
import { operatorReady } from "@/lib/privacy";
import { requireCdek } from "@/lib/delivery/cdek-config";
import { cartDeliveryFingerprint } from "@/lib/delivery/ozon-quote";
import { cdekConfigFingerprint, cdekPackages, signCdekQuote } from "@/lib/delivery/cdek-quote";
import { cdekPointSchema, checkedCdekPoint } from "@/lib/delivery/cdek-points";

function finish(result: string): never { redirect(`/account/integrations/?result=${result}#cdek-delivery`); }

export async function saveCdekDelivery(form: FormData) {
  const user = await requirePermission("settings.write");
  if (!rateLimit(`cdek-settings:${user.id}`, 10, 60000).allowed) finish("cdek-rate");
  const current = await getCdekConfig();
  if (form.has("availabilityVersion") && form.get("availabilityVersion") !== (current.enabled ? "on" : "off")) finish("cdek-changed");
  const parsed = cdekConfigSchema.safeParse({
    enabled: form.get("enabled") === "on",
    clientId: String(form.get("clientId") ?? ""),
    clientSecret: String(form.get("clientSecret") ?? "").trim() || current.clientSecret,
    environment: form.get("environment"),
    senderCityCode: form.get("senderCityCode") ? Number(form.get("senderCityCode")) : null,
    senderPoint: String(form.get("senderPoint") ?? ""),
    senderName: String(form.get("senderName") ?? ""),
    senderPhone: normalizePhone(String(form.get("senderPhone") ?? "")),
  });
  if (!parsed.success) finish("cdek-invalid");
  const config = parsed.data;
  if (config.enabled && (config.environment !== "production" || !config.senderCityCode || !config.senderPoint || !config.senderName || !/^\+7\d{10}$/.test(config.senderPhone))) finish("cdek-invalid");
  if (form.get("intent") === "check" || config.enabled) {
    if (!config.clientId || !config.clientSecret) finish("cdek-invalid");
    try {
      const client = new CdekDeliveryClient(config, config.environment);
      await client.authorize();
      if (config.enabled) {
        const points = z.array(z.object({ code: z.string(), is_reception: z.boolean(), status: z.string(), location: z.object({ city_code: z.number() }) })).parse(await client.deliveryPoint(config.senderPoint));
        if (!points.some(point => point.code === config.senderPoint && point.is_reception && point.status === "ACTIVE" && point.location.city_code === config.senderCityCode)) throw new Error("sender-point");
      }
    }
    catch { finish("cdek-connection"); }
    config.checkedAt = new Date().toISOString();
  } else if (config.clientId === current.clientId && config.clientSecret === current.clientSecret && config.environment === current.environment) {
    config.checkedAt = current.checkedAt;
  }
  const saved = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412030)`;
    if (JSON.stringify(await getCdekConfig(tx)) !== JSON.stringify(current)) return false;
    if ((current.clientId !== config.clientId || current.environment !== config.environment) && await tx.cdekDeliveryJob.count({ where: { status: { notIn: ["CANCELED", "FINISHED"] } } })) return false;
    const value = JSON.parse(JSON.stringify({ ...config, clientSecret: config.clientSecret ? encryptSecret(config.clientSecret, CDEK_SETTING) : "" }));
    await tx.siteSetting.upsert({ where: { key: CDEK_SETTING }, create: { key: CDEK_SETTING, group: "integrations", value }, update: { group: "integrations", value } });
    await tx.auditLog.create({ data: { actorId: user.id, action: "integration.cdek-delivery.update", entityType: "SiteSetting", after: { environment: config.environment, checked: Boolean(config.checkedAt) } } });
    return true;
  });
  if (!saved) finish("cdek-changed");
  revalidatePath("/account/integrations/");
  finish(config.checkedAt ? "cdek-checked" : "cdek-saved");
}

async function publicClient() {
  if (!await operatorReady()) throw new Error("unavailable");
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!rateLimit(`cdek-search:${ip}`, 60, 60000).allowed) throw new Error("rate");
  const config = await getCdekConfig(); requireCdek(config);
  return { config, api: new CdekDeliveryClient(config, config.environment) };
}

export async function cdekCities(input: string) {
  const name = z.string().trim().min(2).max(100).parse(input);
  try {
    const { api } = await publicClient();
    const values = z.array(z.object({ code: z.number().int().positive(), full_name: z.string().min(1).max(300) })).max(100).parse(await api.suggestCities(name));
    return { cities: values.slice(0, 20) };
  } catch { return { error: "Не удалось загрузить города СДЭК. Повторите поиск." }; }
}

const tariffSchema = z.object({ tariff_code: z.number().int().positive(), tariff_name: z.string(), delivery_mode: z.number().int(), delivery_sum: z.number().finite().nonnegative() });
export async function cdekPoints(cityCode: number) {
  if (!z.number().int().positive().safeParse(cityCode).success) return { error: "Выберите город." };
  try {
    const { api } = await publicClient();
    const points = [];
    for (let page = 0; page < 10; page++) {
      const result = z.array(cdekPointSchema).max(1000).parse(await api.deliveryPointsPage(cityCode, page));
      points.push(...result.filter(point => point.is_handout && point.status === "ACTIVE" && point.location.city_code === cityCode).map(point => ({ id: point.code, name: point.name, address: point.location.address_full, type: point.type, workTime: point.work_time || "", latitude: point.location.latitude ?? null, longitude: point.location.longitude ?? null })));
      if (result.length < 1000) return { points };
    }
    return { points, truncated: true };
  } catch { return { error: "Не удалось загрузить ПВЗ СДЭК. Повторите попытку." }; }
}

export async function cdekCalculate(cityCode: number, pointCode: string) {
  if (!z.number().int().positive().safeParse(cityCode).success || !/^[A-Za-z0-9_-]{1,80}$/.test(pointCode)) return { error: "Выберите пункт выдачи." };
  try {
    const { api, config } = await publicClient();
    const cart = await getCart();
    if (!cart?.items.length || cart.items.some(item => !item.available)) throw new Error("cart");
    const packages = cdekPackages(cart);
    const point = await checkedCdekPoint(api, pointCode, cityCode, packages);
    await checkedCdekPoint(api, config.senderPoint, config.senderCityCode!, packages, "sender");
    const request = { type: 2 as const, from_location: { code: config.senderCityCode! }, to_location: { code: cityCode }, shipment_point: config.senderPoint, delivery_point: pointCode, packages };
    const list = z.object({ tariff_codes: z.array(tariffSchema), errors: z.array(z.unknown()).optional() }).parse(await api.tariffList(request));
    const rates = list.tariff_codes.filter(rate => rate.delivery_mode === 4).sort((a, b) => a.delivery_sum - b.delivery_sum).slice(0, 6);
    const calculations = await Promise.allSettled(rates.map(async rate => {
      const value = z.object({ total_sum: z.number().finite().nonnegative().max(999999), currency: z.literal("RUB"), period_min: z.number().int().nonnegative(), period_max: z.number().int().nonnegative(), errors: z.array(z.unknown()).optional() }).parse(await api.tariff({ ...request, tariff_code: rate.tariff_code }));
      if (value.errors?.length) return null;
      const cost = Math.round(value.total_sum * 100) / 100;
      const token = signCdekQuote({ point: pointCode, address: point.location.address_full, cityCode, tariff: rate.tariff_code, cost, daysMin: value.period_min, daysMax: value.period_max, cart: cartDeliveryFingerprint(cart), config: cdekConfigFingerprint(config), expires: Date.now() + 15 * 60000 });
      return { name: rate.tariff_name, cost, daysMin: value.period_min, daysMax: value.period_max, token };
    }));
    return { address: point.location.address_full, rates: calculations.flatMap(result => result.status === "fulfilled" && result.value ? [result.value] : []).sort((a, b) => a.cost - b.cost) };
  } catch (error) {
    return { error: error instanceof Error && error.message === "packaging" ? "У товаров не указаны вес и размеры упаковки. Свяжитесь с магазином." : "СДЭК не подтвердил расчёт для выбранного ПВЗ. Попробуйте другой пункт или повторите позже." };
  }
}
