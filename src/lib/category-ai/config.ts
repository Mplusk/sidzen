import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decryptSecret } from "@/lib/integration-secrets";

export const CATEGORY_AI_KEY = "catalog.category-ai.deepseek";
export const categoryAiModels = ["deepseek-flash", "deepseek-v4-pro"] as const;
export const categoryAiConfigSchema = z.object({
  enabled: z.boolean().default(false),
  apiKey: z.string().max(2048).default(""),
  model: z.enum(categoryAiModels).default("deepseek-flash"),
  allowCreate: z.boolean().default(true),
  revision: z.string().max(100).default(""),
  checkedAt: z.string().max(40).nullable().default(null),
});
export type CategoryAiConfig = z.infer<typeof categoryAiConfigSchema>;
type Database = Pick<Prisma.TransactionClient, "siteSetting">;
export async function getCategoryAiConfig(database: Database = prisma): Promise<CategoryAiConfig> {
  const row = await database.siteSetting.findUnique({ where: { key: CATEGORY_AI_KEY } });
  const stored = categoryAiConfigSchema.parse(row?.value ?? {});
  return { ...stored, apiKey: stored.apiKey ? decryptSecret(stored.apiKey, CATEGORY_AI_KEY) : "" };
}
export function categoryAiReady(config: CategoryAiConfig) { return config.enabled && Boolean(config.apiKey && config.checkedAt && config.revision); }

export async function queueCategoryAi(tx: Prisma.TransactionClient, productId: string, mode: string) {
  if (mode === "AI") {
    const config = await getCategoryAiConfig(tx);
    if (categoryAiReady(config)) {
      await tx.productCategoryAiJob.upsert({ where: { productId },
        create: { productId },
        update: { status: "PENDING", generation: { increment: 1 }, attempts: 0, errorCode: null, leaseToken: null, leaseUntil: null, availableAt: new Date() },
      });
      return;
    }
  }
  await tx.productCategoryAiJob.updateMany({ where: { productId, status: { in: ["PENDING", "RUNNING"] } }, data: { status: "CANCELED", generation: { increment: 1 }, leaseToken: null, leaseUntil: null } });
}
