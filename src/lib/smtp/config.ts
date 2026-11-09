import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/integration-secrets";

export const SMTP_KEY = "notifications.smtp.spaceweb";
export const SMTP_ADDRESS = "support@sidzen.shop";
export const smtpConfigSchema = z.object({
  password: z.string().max(4096).default(""),
  revision: z.string().default(""),
  checkedAt: z.string().nullable().default(null),
});

export async function getSmtpConfig(db: Pick<Prisma.TransactionClient, "siteSetting"> = prisma) {
  const stored = smtpConfigSchema.parse((await db.siteSetting.findUnique({ where: { key: SMTP_KEY } }))?.value ?? {});
  return { ...stored, password: stored.password ? decryptSecret(stored.password, SMTP_KEY) : "" };
}

// Only this projection should be passed to the settings UI.
export async function getSmtpSettingsView() {
  const { password, revision, checkedAt } = await getSmtpConfig();
  return { passwordConfigured: Boolean(password), revision, checkedAt };
}

