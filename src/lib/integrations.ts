import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/integration-secrets";

export const PAYMENT_SETTING = "integrations.yookassa";
export const paymentConfigSchema = z.object({
  enabled: z.boolean(), shopId: z.string().max(100), secret: z.string().max(2000),
  receiptMode: z.enum(["provider", "external"]), vatCode: z.string().regex(/^(?:[1-9]|1[0-2])?$/),
  taxSystemCode: z.string().regex(/^[1-6]?$/), checkedAt: z.string().optional(),
});

export async function getPaymentConfig(database: Pick<typeof prisma, "siteSetting"> = prisma) {
  const row = await database.siteSetting.findUnique({ where: { key: PAYMENT_SETTING } });
  if (row) {
    const config = paymentConfigSchema.parse(row.value);
    return { ...config, secret: config.secret ? decryptSecret(config.secret, PAYMENT_SETTING) : "" };
  }
  return { enabled: process.env.PAYMENT_PROVIDER === "yookassa", shopId: process.env.YOOKASSA_SHOP_ID ?? "", secret: process.env.YOOKASSA_SECRET_KEY ?? "", receiptMode: process.env.YOOKASSA_RECEIPT_MODE === "external" ? "external" as const : "provider" as const, vatCode: process.env.YOOKASSA_VAT_CODE ?? "", taxSystemCode: process.env.YOOKASSA_TAX_SYSTEM_CODE ?? "", checkedAt: undefined };
}

// Read-only credential verification; this never creates or charges a payment.
export async function checkYookassa(config: { shopId: string; secret: string }) {
  if (!config.shopId || !config.secret) throw new Error("credentials");
  const response = await fetch("https://api.yookassa.ru/v3/me", { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000), headers: { Authorization: `Basic ${Buffer.from(`${config.shopId}:${config.secret}`).toString("base64")}` } });
  if (!response.ok) throw new Error("connection");
  const result = z.object({ account_id: z.string(), test: z.boolean(), status: z.string().optional() }).parse(await response.json());
  if (result.account_id !== config.shopId || (result.test && process.env.YOOKASSA_ALLOW_TEST !== "true") || (result.status && result.status !== "enabled")) throw new Error("merchant");
}

export const deliveryConfigSchema = z.object({
  name: z.string().trim().min(2).max(100), description: z.string().trim().max(500),
  basePrice: z.coerce.number().finite().min(0).max(999999).multipleOf(0.01),
  sortOrder: z.coerce.number().int().min(0).max(999), active: z.boolean(),
});
