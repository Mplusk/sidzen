import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { CATALOG_FACET_VERSION, specificationFacets } from "./catalog-facets";

// Presentation facets never alter manufacturing selections, variant prices or carts.
export async function refreshCatalogFacets(tx: Prisma.TransactionClient, productId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${productId} FOR UPDATE`;
  const product = await tx.product.findUniqueOrThrow({ where: { id: productId }, select: { specifications: true } });
  const ids: { id: string }[] = [];
  for (const facet of specificationFacets(product.specifications).sort((a, b) => `${a.kind}:${a.slug}`.localeCompare(`${b.kind}:${b.slug}`))) ids.push(await tx.catalogFacet.upsert({
    where: { kind_slug: { kind: facet.kind, slug: facet.slug } }, create: facet, update: {}, select: { id: true },
  }));
  await tx.product.update({ where: { id: productId }, data: { catalogFacets: { set: ids }, catalogFacetVersion: CATALOG_FACET_VERSION } });
}
export async function backfillCatalogFacets() {
  const rows = await prisma.product.findMany({ where: { catalogFacetVersion: { lt: CATALOG_FACET_VERSION } }, select: { id: true }, take: 20, orderBy: { id: "asc" } });
  for (const row of rows) await prisma.$transaction(tx => refreshCatalogFacets(tx, row.id));
  return rows.length > 0;
}
