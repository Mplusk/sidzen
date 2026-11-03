import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/integration-secrets";

export const CDEK_SETTING = "integrations.cdek-delivery";
export const CDEK_DELIVERY_CODE = "cdek-delivery";
export const cdekConfigSchema = z.object({
  enabled: z.boolean().default(false),
  clientId: z.string().trim().max(200),
  clientSecret: z.string().max(4000),
  environment: z.enum(["test", "production"]),
  senderCityCode: z.number().int().positive().nullable(),
  senderPoint: z.string().trim().max(80),
  senderName: z.string().trim().max(120),
  senderPhone: z.string().trim().max(30),
  checkedAt: z.string().optional(),
});
export type CdekConfig = z.infer<typeof cdekConfigSchema>;

export async function getCdekConfig(database: Pick<typeof prisma, "siteSetting"> = prisma): Promise<CdekConfig> {
  const row = await database.siteSetting.findUnique({ where: { key: CDEK_SETTING } });
  if (!row) return { enabled: false, clientId: "", clientSecret: "", environment: "test", senderCityCode: null, senderPoint: "", senderName: "", senderPhone: "" };
  const config = cdekConfigSchema.parse(row.value);
  return { ...config, clientSecret: config.clientSecret ? decryptSecret(config.clientSecret, CDEK_SETTING) : "" };
}

export function requireCdek(config: CdekConfig) {
  if (!config.enabled || config.environment !== "production" || !config.clientId || !config.clientSecret || !config.checkedAt || !config.senderCityCode || !config.senderPoint || !config.senderName || !/^\+7\d{10}$/.test(config.senderPhone)) throw new Error("cdek-disabled");
}
