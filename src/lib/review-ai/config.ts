import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
export const REVIEW_AI_KEY = "reviews.deepseek.moderation";
export const reviewAiConfigSchema = z.object({ enabled: z.boolean().default(false), operatorReviewed: z.boolean().default(false), revision: z.string().default("") });
export async function getReviewAiConfig(db: Pick<Prisma.TransactionClient, "siteSetting"> = prisma) {
  return reviewAiConfigSchema.parse((await db.siteSetting.findUnique({ where: { key: REVIEW_AI_KEY } }))?.value ?? {});
}
