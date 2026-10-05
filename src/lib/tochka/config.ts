import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/integration-secrets";

export const TOCHKA_SETTING = "integrations.tochka";
export const vatTypes = ["none", "vat0", "vat5", "vat7", "vat10", "vat22", "vat105", "vat107", "vat110", "vat122"] as const;
export const taxSystems = ["osn", "usn_income", "usn_income_outcome", "esn", "patent"] as const;
export const tochkaConfigSchema = z.object({
  enabled: z.boolean(), token: z.string().max(16000),
  customerCode: z.string().regex(/^(?:[a-zA-Z0-9]{9})?$/), merchantId: z.string().regex(/^(?:\d{15})?$/),
  card: z.boolean(), sbp: z.boolean(), receiptMode: z.enum(["provider", "external", "cloudkassir"]),
  vatType: z.enum(["", ...vatTypes]), taxSystemCode: z.enum(["", ...taxSystems]),
  externalReceiptsConfirmed: z.boolean().default(false), checkedAt: z.iso.datetime().optional(),
});
export type TochkaConfig = z.infer<typeof tochkaConfigSchema>;

export async function getTochkaConfig(database: Pick<typeof prisma, "siteSetting"> = prisma): Promise<TochkaConfig> {
  const row = await database.siteSetting.findUnique({ where: { key: TOCHKA_SETTING } });
  if (row) {
    // AES ciphertext is longer than the plaintext JWT accepted by the form.
    const config = tochkaConfigSchema.extend({ token: z.string().max(24000) }).parse(row.value);
    return tochkaConfigSchema.parse({ ...config, token: config.token ? decryptSecret(config.token, TOCHKA_SETTING) : "" });
  }
  return tochkaConfigSchema.parse({ enabled: process.env.PAYMENT_PROVIDER === "tochka", token: process.env.TOCHKA_TOKEN ?? "", customerCode: process.env.TOCHKA_CUSTOMER_CODE ?? "", merchantId: process.env.TOCHKA_MERCHANT_ID ?? "", card: true, sbp: true, receiptMode: "cloudkassir", vatType: "none", taxSystemCode: "usn_income", externalReceiptsConfirmed: false });
}

export function validProductionToken(token: string) {
  return token.length >= 20 && token.length <= 16000 && /^[A-Za-z0-9._~-]+$/.test(token) && !token.toLowerCase().includes("sandbox");
}

export function tochkaReady(config: TochkaConfig) {
  return config.enabled && Boolean(config.checkedAt) && validProductionToken(config.token) && Boolean(config.customerCode && config.merchantId && (config.card || config.sbp)) && (config.receiptMode === "cloudkassir" || (config.receiptMode === "external" ? config.externalReceiptsConfirmed : Boolean(config.vatType && config.taxSystemCode)));
}
