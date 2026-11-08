import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/integration-secrets";

export const YANDEX_MAPS_SETTING = "maps.yandex";
export type YandexMapsConfig = { apiKey: string; revision: string };

export async function getYandexMapsConfig(db: Pick<Prisma.TransactionClient, "siteSetting"> = prisma): Promise<YandexMapsConfig> {
  const row = await db.siteSetting.findUnique({ where: { key: YANDEX_MAPS_SETTING } });
  const value = row?.value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return { apiKey: "", revision: "" };
  const encrypted = typeof value.apiKey === "string" ? value.apiKey : "";
  return { apiKey: encrypted ? decryptSecret(encrypted, YANDEX_MAPS_SETTING) : "", revision: typeof value.revision === "string" ? value.revision : "" };
}
