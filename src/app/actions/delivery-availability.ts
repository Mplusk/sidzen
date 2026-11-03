"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { CDEK_SETTING, getCdekConfig, requireCdek } from "@/lib/delivery/cdek-config";
import { CdekDeliveryClient } from "@/lib/delivery/cdek-client";
import { getOzonDeliveryConfig, OZON_DELIVERY_SETTING, requireOzonDelivery } from "@/lib/delivery/ozon-config";
import { OzonDeliveryClient } from "@/lib/delivery/ozon-client";

export async function setDeliveryAvailability(carrier: "ozon" | "cdek", enabled: boolean): Promise<{ error?: string }> {
  const user = await requirePermission("settings.write");
  if ((carrier !== "ozon" && carrier !== "cdek") || typeof enabled !== "boolean") return { error: "Некорректный запрос. Обновите страницу." };
  if (!rateLimit(`delivery-availability:${user.id}`, 20, 60000).allowed) return { error: "Слишком много изменений. Попробуйте через минуту." };

  const current = carrier === "ozon" ? await getOzonDeliveryConfig() : await getCdekConfig();
  if (current.enabled === enabled) return {};
  if (enabled) {
    try {
      if (carrier === "ozon") {
        const config = await getOzonDeliveryConfig();
        requireOzonDelivery({ ...config, enabled: true });
        const api = new OzonDeliveryClient(config);
        await api.verifyMethod(config.shipmentMethodId!);
        await api.pointPage(null);
      } else {
        const config = await getCdekConfig();
        requireCdek({ ...config, enabled: true });
        const api = new CdekDeliveryClient(config, config.environment);
        await api.authorize();
        const points = z.array(z.object({ code: z.string(), is_reception: z.boolean(), status: z.string(), location: z.object({ city_code: z.number() }) })).parse(await api.deliveryPoint(config.senderPoint));
        if (!points.some(point => point.code === config.senderPoint && point.is_reception && point.status === "ACTIVE" && point.location.city_code === config.senderCityCode)) throw new Error("sender-point");
      }
    } catch {
      return { error: "Не удалось включить доставку. Проверьте настройки и подключение ниже." };
    }
  }

  const saved = await prisma.$transaction(async tx => {
    if (carrier === "ozon") await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412027)`;
    else await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412030)`;
    const latest = carrier === "ozon" ? await getOzonDeliveryConfig(tx) : await getCdekConfig(tx);
    if (JSON.stringify(current) !== JSON.stringify(latest)) return false;
    const key = carrier === "ozon" ? OZON_DELIVERY_SETTING : CDEK_SETTING;
    const row = await tx.siteSetting.findUnique({ where: { key } });
    if (!row || !row.value || typeof row.value !== "object" || Array.isArray(row.value)) return false;
    await tx.siteSetting.update({ where: { key }, data: { value: { ...row.value, enabled } } });
    if (carrier === "ozon" && enabled) {
      const config = await getOzonDeliveryConfig(tx);
      const data = { clientId: config.clientId, methodId: BigInt(config.shipmentMethodId!), generation: randomUUID(), cursor: null, pages: 0, points: 0, error: null, status: "PENDING", lockedUntil: null, lockToken: null };
      await tx.ozonDeliverySync.upsert({ where: { id: "ozon" }, create: { id: "ozon", ...data }, update: data });
    }
    await tx.auditLog.create({ data: { actorId: user.id, action: `integration.${carrier}-delivery.update`, entityType: "SiteSetting", after: { enabled } } });
    return true;
  });
  if (!saved) return { error: "Настройки изменились. Обновите страницу и повторите." };
  revalidatePath("/account/integrations/");
  revalidatePath("/checkout/");
  return {};
}
