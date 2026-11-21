"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { getCart } from "./cart";
import { checkoutCart } from "@/lib/checkout-cart";
import { requirePermission } from "@/lib/auth";
import { operatorReady } from "@/lib/privacy";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { encryptSecret } from "@/lib/integration-secrets";
import { FIVEPOST_SETTING, fivePostReady, fivePostSchema, fivePostScope, getFivePostConfig } from "@/lib/delivery/fivepost-config";
import { FivePostClient } from "@/lib/delivery/fivepost-client";
import { selectedFivePostPoint } from "@/lib/delivery/fivepost-directory";
import { fivePostQuote } from "@/lib/delivery/fivepost-quote";

function finish(result: string): never { redirect(`/account/integrations/?result=fivepost-${result}#fivepost-delivery`); }
export async function saveFivePostDelivery(form: FormData) {
  const actor = await requirePermission("settings.write");
  if (!rateLimit(`fivepost-settings:${actor.id}`, 15, 60000).allowed) finish("rate");
  const current = await getFivePostConfig();
  if (String(form.get("version")) !== JSON.stringify([current.checkedAt, current.enabled])) finish("changed");
  const intent = form.get("intent");
  if (intent !== "disable" && intent !== "enable" && intent !== "check") finish("invalid");
  let config = { ...current, enabled: false };
  if (intent !== "disable") {
    const key = String(form.get("apiKey") ?? "").trim();
    const environment = form.get("environment");
    if (environment !== current.environment && !key) finish("invalid");
    const parsed = fivePostSchema.safeParse({
      enabled: intent === "enable", environment, apiKey: key || current.apiKey,
      warehouseId: String(form.get("warehouseId") ?? "").trim().toLowerCase(), rateType: form.get("rateType"),
      baseKg: form.get("baseKg") ? Number(form.get("baseKg")) : null, slCode: form.get("slCode") ? Number(form.get("slCode")) : null,
      buyerPays: form.get("buyerPays") === "on",
    });
    if (!parsed.success || !parsed.data.apiKey || !parsed.data.warehouseId || (parsed.data.enabled && (environment !== "production" || !parsed.data.rateType || !parsed.data.baseKg))) finish("invalid");
    config = parsed.data;
    try {
      const api = new FivePostClient(config);
      config.senderLocation = await api.warehouse(config.warehouseId);
      await api.points(0, 1);
    } catch { finish("connection"); }
    config.checkedAt = new Date().toISOString();
    // Checking the existing production configuration keeps its current availability.
    if (intent === "check" && current.enabled && fivePostScope(config) === fivePostScope(current) && config.baseKg) config.enabled = true;
  }
  const result = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(53415001)`;
    if (JSON.stringify(await getFivePostConfig(tx)) !== JSON.stringify(current)) return "changed";
    if ((config.environment !== current.environment || config.warehouseId !== current.warehouseId) &&
      await tx.fivePostDeliveryJob.count({ where: { status: { notIn: ["CANCELED", "FINISHED"] } } })) return "pending";
    const value = { ...config, apiKey: config.apiKey ? encryptSecret(config.apiKey, FIVEPOST_SETTING) : "" };
    await tx.siteSetting.upsert({ where: { key: FIVEPOST_SETTING }, create: { key: FIVEPOST_SETTING, group: "integrations", value }, update: { value } });
    if (fivePostReady(config)) {
      const scope = fivePostScope(config);
      const directory = await tx.fivePostDirectory.findUnique({ where: { id: "5post" } });
      if (directory?.scope !== scope) {
        const data = { scope, staging: randomUUID(), active: null, refreshedAt: null, nextAttemptAt: new Date(), page: 0, error: null };
        await tx.fivePostDirectory.upsert({ where: { id: "5post" }, update: data, create: { id: "5post", ...data } });
      }
    }
    await tx.auditLog.create({ data: { actorId: actor.id, action: "integration.fivepost-delivery.update", entityType: "SiteSetting", after: { enabled: config.enabled, environment: config.environment } } });
    return intent === "disable" ? "off" : config.enabled ? "on" : "checked";
  });
  revalidatePath("/account/integrations/");
  revalidatePath("/checkout/");
  revalidatePath("/delivery/");
  finish(result);
}

export async function quoteFivePostPoint(id: string) {
  if (!z.guid().safeParse(id).success) return { error: "Выберите пункт выдачи 5Post." };
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!rateLimit(`fivepost-quote:${ip}`, 50, 60000).allowed) return { error: "Повторите проверку через минуту." };
  try {
    if (!await operatorReady()) throw new Error("unavailable");
    const [{ config, point }, cart] = await Promise.all([selectedFivePostPoint(id), getCart().then(checkoutCart)]);
    if (!cart?.items.length) throw new Error("cart");
    const { address, token, price, days } = fivePostQuote(point, cart, config);
    return { quote: { address, token, price, days } };
  } catch (error) {
    return { error: error instanceof Error && error.message === "fivepost-size" ? "Посылка не помещается в этот пункт. Выберите другой ПВЗ." : "Для этого пункта расчёт недоступен. Проверьте корзину или выберите другой пункт." };
  }
}
