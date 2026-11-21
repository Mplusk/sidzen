import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/integration-secrets";

export const FIVEPOST_SETTING = "integrations.fivepost-delivery";
export const FIVEPOST_CODE = "fivepost-delivery";
export const fivePostSchema = z.object({
  enabled: z.boolean().default(false),
  environment: z.enum(["test", "production"]).default("test"),
  apiKey: z.string().trim().max(2000).default(""),
  warehouseId: z.union([z.guid(), z.literal("")]).default(""),
  senderLocation: z.string().max(255).default(""),
  rateType: z.string().trim().max(120).default(""),
  baseKg: z.number().int().min(1).max(100).nullable().default(null),
  slCode: z.number().int().positive().nullable().default(null),
  buyerPays: z.boolean().default(false),
  checkedAt: z.string().nullable().default(null),
});
export type FivePostConfig = z.infer<typeof fivePostSchema>;
export async function getFivePostConfig(db: Pick<typeof prisma, "siteSetting"> = prisma) {
  const row = await db.siteSetting.findUnique({ where: { key: FIVEPOST_SETTING } });
  const config = fivePostSchema.parse(row?.value ?? {});
  return { ...config, apiKey: config.apiKey ? decryptSecret(config.apiKey, FIVEPOST_SETTING) : "" };
}
export function fivePostReady(config: FivePostConfig) {
  return Boolean(config.enabled && config.environment === "production" && config.apiKey && config.checkedAt && config.warehouseId && config.senderLocation && config.rateType && config.baseKg);
}
export function fivePostScope(config: FivePostConfig) {
  return createHash("sha256").update(JSON.stringify([config.environment, config.apiKey, config.warehouseId, config.rateType, config.slCode])).digest("hex");
}
export function activeFivePostGeneration(config: FivePostConfig, directory: { scope: string; active: string | null; refreshedAt: Date | null } | null) {
  if (!fivePostReady(config) || directory?.scope !== fivePostScope(config) || !directory.refreshedAt || Date.now() - directory.refreshedAt.getTime() > 48 * 3600000) return null;
  return directory.active;
}
