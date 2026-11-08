"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { encryptSecret } from "@/lib/integration-secrets";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getYandexMapsConfig, YANDEX_MAPS_SETTING } from "@/lib/yandex-maps/config";

export async function saveYandexMapsSettings(form: FormData) {
  const actor = await requirePermission("settings.write");
  const result = (code: string): never => redirect(`/account/integrations/?result=maps-${code}#yandex-maps`);
  if (!rateLimit(`yandex-maps-settings:${actor.id}`, 5, 60_000).allowed) result("rate");
  const current = await getYandexMapsConfig();
  const supplied = String(form.get("apiKey") ?? "").trim();
  if (supplied && !/^[A-Za-z0-9_-]{16,128}$/.test(supplied)) result("invalid");
  const apiKey = form.get("clearKey") === "on" ? "" : supplied || current.apiKey;
  const saved = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412051)`;
    if ((await getYandexMapsConfig(tx)).revision !== String(form.get("revision") ?? "")) return false;
    const value = { apiKey: apiKey ? encryptSecret(apiKey, YANDEX_MAPS_SETTING) : "", revision: randomUUID() };
    await tx.siteSetting.upsert({ where: { key: YANDEX_MAPS_SETTING }, create: { key: YANDEX_MAPS_SETTING, group: "integrations", label: "Яндекс Карты", value }, update: { value } });
    await tx.auditLog.create({ data: { actorId: actor.id, action: "integration.yandex-maps.update", entityType: "SiteSetting", after: { configured: !!apiKey, credentialsChanged: apiKey !== current.apiKey } } });
    return true;
  });
  if (!saved) result("changed");
  revalidatePath("/account/integrations/"); result("saved");
}
