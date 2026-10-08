// Explicit, bounded maintenance operation requested by the store owner.
// Dry-run by default. Never run automatically during deployment or import.
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { marketplaceLock } from "@/lib/marketplaces/sync";
import { queueCategoryAi } from "@/lib/category-ai/config";
import { catalogInvalidationToken } from "@/lib/marketplaces/cache-token";

const skus = ["300010", "300011", "300012", "300013", "300014", "300016", "300017"];
const name = "Настольные светильники";
const apply = process.env.APPLY_CATEGORY_CORRECTION === "1";
try {
  const result = await prisma.$transaction(async tx => {
    await marketplaceLock(tx);
    assert.equal(await tx.marketplaceSyncRun.count({ where: { status: { in: ["QUEUED", "RUNNING"] } } }), 0, "Wait for marketplace imports to finish");
    const categories = await tx.category.findMany({ where: { name, visible: true } });
    assert.equal(categories.length, 1, "Expected one existing visible table-lamp category");
    const category = categories[0];
    const products = await tx.product.findMany({ where: { sku: { in: skus } }, include: { categories: { include: { category: true } } }, orderBy: { sku: "asc" } });
    assert.equal(products.length, skus.length, "Expected all seven inspected lamps; abort rather than partially correct");
    assert(products.every(product => /светильник.*настольн|настольн.*светильник/iu.test(product.name)), "Unexpected SKU/type: inspect before applying");
    let changed = 0;
    for (const product of products) {
      // Keep the published decor URL working as a secondary catalog link;
      // it does not compete with the corrected primary table-lamp category.
      const secondary = product.status === "PUBLISHED" ? product.categories.filter(row => row.category.slug === "decor") : [];
      const desired = [...new Set([category.id, ...secondary.map(row => row.categoryId)])];
      const correct = product.categoryMode === "MANUAL" && product.categories.length === desired.length && product.categories.every(row => desired.includes(row.categoryId) && row.isPrimary === (row.categoryId === category.id));
      if (correct) continue;
      changed++;
      if (!apply) continue;
      await tx.productCategory.deleteMany({ where: { productId: product.id, categoryId: { notIn: desired } } });
      await tx.productCategory.updateMany({ where: { productId: product.id }, data: { isPrimary: false } });
      await tx.productCategory.upsert({ where: { productId_categoryId: { productId: product.id, categoryId: category.id } }, create: { productId: product.id, categoryId: category.id, isPrimary: true }, update: { isPrimary: true } });
      await tx.product.update({ where: { id: product.id }, data: { categoryMode: "MANUAL" } });
      await queueCategoryAi(tx, product.id, "MANUAL");
      await tx.auditLog.create({ data: { action: "product.category.owner-correction", entityType: "Product", entityId: product.id,
        before: { categoryMode: product.categoryMode, categories: product.categories.map(row => ({ categoryId: row.categoryId, isPrimary: row.isPrimary })) },
        after: { categoryId: category.id, categoryMode: "MANUAL", source: "owner-request-20261008" },
      } });
    }
    return { applied: apply, products: products.length, changed, category: category.name };
  }, { maxWait: 10_000, timeout: 30_000 });
  console.log(JSON.stringify(result));
  if (apply && result.changed) {
    const response = await fetch(`${process.env.MARKETPLACE_APP_URL || "http://app:3000"}/api/internal/catalog-invalidate/`, { method: "POST", headers: { Authorization: `Bearer ${catalogInvalidationToken()}` }, redirect: "error", signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 204, "Correction applied, but cache refresh needs retry");
    console.log("Catalog cache refreshed; prices, publication and inventory unchanged.");
  }
} finally { await prisma.$disconnect(); }
