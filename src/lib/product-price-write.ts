import { Prisma } from "@prisma/client";
import { refreshCatalogFacets } from "@/lib/catalog-facets-server";
import { guardProductWrite, marketplaceLock } from "@/lib/marketplaces/sync";

export type ProductPriceWrite = {
  id: string;
  version: Date;
  originalStatus: string;
  basePrice: Prisma.Decimal;
  oldPrice: Prisma.Decimal | null;
  originalBasePrice: Prisma.Decimal;
  originalOldPrice: Prisma.Decimal | null;
  actorId: string;
  canPublish: boolean;
  acceptSiteMode: boolean;
};

/** Caller supplies the transaction; all product, facet and audit writes commit together. */
export async function writeProductPrice(tx: Prisma.TransactionClient, input: ProductPriceWrite): Promise<void> {
  const { id, version, originalStatus, basePrice, oldPrice, originalBasePrice, originalOldPrice, actorId, canPublish, acceptSiteMode } = input;
  await marketplaceLock(tx);
  const [product] = await tx.$queryRaw<Array<{ id: string; sku: string; status: string; marketplaceMode: string; updatedAt: Date; basePrice: Prisma.Decimal; oldPrice: Prisma.Decimal | null }>>`
    SELECT "id", "sku", "status"::text AS "status", "marketplaceMode", "updatedAt", "basePrice", "oldPrice" FROM "Product" WHERE "id" = ${id} FOR UPDATE`;
  if (!product) throw new Error("missing");
  if (product.status === "PUBLISHED" && !canPublish) throw new Error("permission");
  if (product.status !== originalStatus || product.updatedAt.getTime() !== version.getTime() || !product.basePrice.equals(originalBasePrice) || (product.oldPrice == null ? originalOldPrice !== null : originalOldPrice === null || !product.oldPrice.equals(originalOldPrice))) throw new Error("stale");
  await guardProductWrite(tx, product.sku, id);
  const changed = !product.basePrice.equals(basePrice) || (product.oldPrice == null ? oldPrice !== null : oldPrice === null || !product.oldPrice.equals(oldPrice));
  if (!changed) return;
  const linked = await tx.marketplaceListing.count({ where: { productId: id } });
  if (linked && product.marketplaceMode !== "SITE" && !acceptSiteMode) throw new Error("confirm-site-mode");
  await tx.product.update({ where: { id }, data: { basePrice, oldPrice, ...(linked ? { marketplaceMode: "SITE" } : {}) } });
  await refreshCatalogFacets(tx, id);
  await tx.auditLog.create({ data: { actorId, action: "product.price.update", entityType: "Product", entityId: id, before: { basePrice: product.basePrice.toString(), oldPrice: product.oldPrice?.toString() ?? null }, after: { basePrice: basePrice.toString(), oldPrice: oldPrice?.toString() ?? null, ...(linked ? { marketplaceMode: "SITE" } : {}) } } });
}
