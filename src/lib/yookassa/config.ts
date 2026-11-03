import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/integration-secrets";

// Separate from the archived YooKassa integration: old credentials and flags
// must never silently turn the new checkout on.
export const YOOKASSA_ONLINE_SETTING = "integrations.yookassa-online";
export const yookassaConfigSchema = z.object({
  enabled: z.boolean().default(false), shopId: z.string().trim().regex(/^\d{0,32}$/), secret: z.string().max(2000),
  receiptsConfirmed: z.boolean().default(false), checkedAt: z.iso.datetime().optional(),
});
export type YooKassaConfig = z.infer<typeof yookassaConfigSchema>;

export async function getYooKassaConfig(db: Pick<typeof prisma, "siteSetting"> = prisma): Promise<YooKassaConfig> {
  const row = await db.siteSetting.findUnique({ where: { key: YOOKASSA_ONLINE_SETTING } });
  if (!row) return { enabled: false, shopId: "", secret: "", receiptsConfirmed: false };
  const value = yookassaConfigSchema.parse(row.value);
  return { ...value, secret: value.secret ? decryptSecret(value.secret, YOOKASSA_ONLINE_SETTING) : "" };
}
export function yookassaReady(config: YooKassaConfig) {
  return config.enabled && Boolean(config.shopId && config.secret && config.receiptsConfirmed && config.checkedAt);
}
