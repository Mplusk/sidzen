import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/integration-secrets";

export const CLOUD_SETTING = "integrations.cloudkassir";
export const RECEIPT_PURPOSE = "cloudkassir.receipt";
export const cloudSchema = z.object({
  enabled: z.boolean().default(false), publicId: z.string().max(128).regex(/^[A-Za-z0-9_-]*$/).default(""),
  apiSecret: z.string().max(2048).default(""), inn: z.string().regex(/^(?:\d{10}|\d{12})?$/).default(""),
  deviceNumber: z.string().regex(/^\d{0,24}$/).default(""), fiscalNumber: z.string().regex(/^\d{0,16}$/).default(""),
  taxRegime: z.literal("ausn_income").default("ausn_income"), vat: z.literal("none").default("none"),
  productionConfirmed: z.boolean().default(false), operatorReviewed: z.boolean().default(false),
  taxConfirmed: z.boolean().default(false), checkedAt: z.iso.datetime().optional(),
});
export type CloudConfig = z.infer<typeof cloudSchema>;
export async function getCloudConfig(database: Pick<typeof prisma, "siteSetting"> = prisma): Promise<CloudConfig> {
  const row = await database.siteSetting.findUnique({ where: { key: CLOUD_SETTING } });
  if (!row) return cloudSchema.parse({});
  const stored = cloudSchema.extend({ apiSecret: z.string().max(4096) }).parse(row.value);
  return cloudSchema.parse({ ...stored, apiSecret: stored.apiSecret ? decryptSecret(stored.apiSecret, CLOUD_SETTING) : "" });
}
export function validInn(inn: string) {
  const digits = [...inn].map(Number);
  const check = (weights: number[]) => weights.reduce((sum, weight, i) => sum + weight * digits[i], 0) % 11 % 10;
  if (!/^(?:\d{10}|\d{12})$/.test(inn) || /^0+$/.test(inn)) return false;
  return inn.length === 10 ? check([2, 4, 10, 3, 5, 9, 4, 6, 8]) === digits[9] : inn.length === 12 && check([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === digits[10] && check([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === digits[11];
}
export function cloudConfigured(config: CloudConfig) {
  return Boolean(config.checkedAt && config.publicId && config.apiSecret && validInn(config.inn) && config.deviceNumber && config.fiscalNumber.length === 16 && config.productionConfirmed && config.operatorReviewed && config.taxConfirmed);
}
export function cloudReady(config: CloudConfig) { return config.enabled && cloudConfigured(config); }
