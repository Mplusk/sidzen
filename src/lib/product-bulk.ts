import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { PRODUCT_STATUSES } from "@/lib/product-admin";
import { marketplaceLock } from "@/lib/marketplaces/sync";
import { queueCategoryAi } from "@/lib/category-ai/config";

export const bulkProductSchema = z.object({
  productIds: z.array(z.string().min(1).max(100)).min(1).max(500),
  status: z.enum(PRODUCT_STATUSES), categoryId: z.string().max(100).default(""),
});
export type BulkProductInput = z.infer<typeof bulkProductSchema>;
export class ProductBulkError extends Error {
  constructor(public code: string, public skus: string[] = []) { super(code); }
}

export async function setProductsStatus(input: BulkProductInput, actor: { id: string; canPublish: boolean }) {
  const data = bulkProductSchema.parse(input), ids = [...new Set(data.productIds)];
  return prisma.$transaction(async tx => {
    await marketplaceLock(tx);
    if (await tx.marketplaceSyncRun.count({ where: { status: { in: ["QUEUED", "RUNNING"] } } })) throw new ProductBulkError("busy");
    const products = await tx.product.findMany({ where: { id: { in: ids } }, include: { categories: { include: { category: { select: { visible: true } } } } } });
    if (products.length !== ids.length || products.some(product => !["READY", "PARAMETRIC"].includes(product.type))) throw new ProductBulkError("missing");
    if (!actor.canPublish && (data.status === "PUBLISHED" || products.some(product => product.status === "PUBLISHED"))) throw new ProductBulkError("permission");
    const fallback = data.status === "PUBLISHED" && data.categoryId ? await tx.category.findUnique({ where: { id: data.categoryId }, select: { id: true, visible: true } }) : null;
    if (data.status === "PUBLISHED" && data.categoryId && !fallback?.visible) throw new ProductBulkError("category");
    const missing = data.status === "PUBLISHED" && !fallback ? products.filter(product => !product.categories.some(row => row.category.visible)) : [];
    if (missing.length) throw new ProductBulkError("category", missing.map(product => product.sku));
    const now = new Date();
    for (const product of products) {
      let categoryId: string | null = null;
      if (data.status === "PUBLISHED") {
        const primary = product.categories.find(row => row.isPrimary) ?? product.categories[0];
        if (!primary?.category.visible) {
          const visible = product.categories.find(row => row.category.visible);
          categoryId = visible?.categoryId ?? fallback!.id;
          await tx.productCategory.updateMany({ where: { productId: product.id }, data: { isPrimary: false } });
          await tx.productCategory.upsert({ where: { productId_categoryId: { productId: product.id, categoryId } }, create: { productId: product.id, categoryId, isPrimary: true }, update: { isPrimary: true } });
          await queueCategoryAi(tx, product.id, "MANUAL");
        }
      }
      await tx.product.update({ where: { id: product.id }, data: { status: data.status, ...(categoryId ? { categoryMode: "MANUAL" } : {}), publishedAt: data.status === "PUBLISHED" ? product.publishedAt ?? now : null } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "product.status.bulk", entityType: "Product", entityId: product.id,
        before: { status: product.status, publishedAt: product.publishedAt?.toISOString() ?? null },
        after: { status: data.status, ...(categoryId ? { primaryCategoryId: categoryId } : {}) },
      } });
    }
    return products.length;
  }, { maxWait: 10_000, timeout: 30_000 });
}
