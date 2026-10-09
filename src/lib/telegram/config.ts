import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/integration-secrets";
export const TELEGRAM_KEY = "notifications.telegram.orders";
export const telegramConfigSchema = z.object({ enabled: z.boolean().default(false), token: z.string().max(2048).default(""), chatId: z.string().max(30).default(""), revision: z.string().default(""), checkedAt: z.string().nullable().default(null) });
export type TelegramConfig = z.infer<typeof telegramConfigSchema>;
export async function getTelegramConfig(db: Pick<Prisma.TransactionClient, "siteSetting"> = prisma) {
  const stored = telegramConfigSchema.parse((await db.siteSetting.findUnique({ where: { key: TELEGRAM_KEY } }))?.value ?? {});
  return { ...stored, token: stored.token ? decryptSecret(stored.token, TELEGRAM_KEY) : "" };
}
export async function queueTelegramOrder(tx: Prisma.TransactionClient, orderId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412041)`;
  let config: TelegramConfig;
  try { config = await getTelegramConfig(tx); }
  catch {
    // A broken optional integration must not lose an otherwise valid order.
    await tx.telegramOrderJob.create({ data: { orderId, revision: "", status: "FAILED", errorCode: "credentials" } }); return;
  }
  if (config.enabled && config.token && config.chatId && config.checkedAt) await tx.telegramOrderJob.create({ data: { orderId, revision: config.revision } });
}
