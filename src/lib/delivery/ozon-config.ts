import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/integration-secrets";
import { OzonDeliveryError, positiveId } from "./ozon-client";

export const OZON_DELIVERY_SETTING = "integrations.ozon-delivery";
export const OZON_DELIVERY_CODE = "ozon-delivery";
export const ozonDeliveryConfigSchema = z.object({ enabled: z.boolean(), clientId: z.string().trim().max(200), clientSecret: z.string().max(4000), shipmentMethodId: positiveId.nullable(), dispatchDays: z.number().int().min(1).max(30), checkedAt: z.string().optional(), methodName: z.string().optional() });
export type OzonDeliveryConfig = z.infer<typeof ozonDeliveryConfigSchema>;
export async function getOzonDeliveryConfig(database: Pick<typeof prisma, "siteSetting"> = prisma): Promise<OzonDeliveryConfig> {
  const row = await database.siteSetting.findUnique({ where: { key: OZON_DELIVERY_SETTING } });
  if (!row) return { enabled: false, clientId: "", clientSecret: "", shipmentMethodId: null, dispatchDays: 1 };
  const config = ozonDeliveryConfigSchema.parse(row.value);
  return { ...config, clientSecret: config.clientSecret ? decryptSecret(config.clientSecret, OZON_DELIVERY_SETTING) : "" };
}
export function deliveryConfigFingerprint(config: OzonDeliveryConfig) {
  return createHash("sha256").update(JSON.stringify([config.clientId, config.shipmentMethodId, config.dispatchDays])).digest("hex");
}
export function requireOzonDelivery(config: OzonDeliveryConfig) {
  if (!config.enabled || !config.clientId || !config.clientSecret || !config.shipmentMethodId || !config.checkedAt) throw new OzonDeliveryError("disabled");
}
