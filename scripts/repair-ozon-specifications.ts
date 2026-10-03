import { prisma } from "../src/lib/prisma";
import { getConnection } from "../src/lib/marketplaces/config";
import { fetchOzonAttributes } from "../src/lib/marketplaces/api";
import { repairLegacyOzonSpecifications, type OzonAttributeCache } from "../src/lib/marketplaces/ozon-attributes";
import { marketplaceLock } from "../src/lib/marketplaces/sync";
import { catalogInvalidationToken } from "../src/lib/marketplaces/cache-token";
import type { Prisma } from "@prisma/client";

const apply = process.argv.includes("--apply");
const legacy = (value: unknown) => Boolean(value && typeof value === "object" && Object.keys(value).some(key => /^Ozon\s*[·.]\s*\d+$/i.test(key)));
try {
  const connection = await getConnection("ozon");
  if (!connection) throw new Error("Ozon is not connected");
  if (await prisma.marketplaceSyncRun.count({ where: { status: { in: ["QUEUED", "RUNNING"] } } })) throw new Error("Wait for active synchronization");
  const listings = await prisma.marketplaceListing.findMany({ where: { provider: "ozon", accountId: connection.accountId }, include: { product: { select: { id: true, specifications: true } } } });
  const targets = listings.filter(listing => legacy((listing.snapshot as Record<string, unknown>)?.specifications) || legacy(listing.product?.specifications));
  const cache: OzonAttributeCache = new Map();
  let repaired = 0;
  for (let offset = 0; offset < targets.length; offset += 20) {
    const batch = targets.slice(offset, offset + 20);
    const attributes = await fetchOzonAttributes(connection, batch.map(listing => listing.externalId), fetch, cache);
    for (const listing of batch) {
      const source = attributes.get(listing.externalId);
      if (!source) throw new Error("Product attributes missing; no change applied");
      const snapshot = listing.snapshot as Record<string, unknown>;
      const sourceRepair = repairLegacyOzonSpecifications(snapshot.specifications, source.labels);
      const productRepair = repairLegacyOzonSpecifications(listing.product?.specifications, source.labels);
      if (!sourceRepair.changed && !productRepair.changed) continue;
      if (apply) await prisma.$transaction(async tx => {
        await marketplaceLock(tx);
        if (await tx.marketplaceSyncRun.count({ where: { status: { in: ["QUEUED", "RUNNING"] } } })) throw new Error("Synchronization started; retry later");
        const current = await tx.marketplaceListing.findUniqueOrThrow({ where: { id: listing.id }, include: { product: { select: { specifications: true } } } });
        if (JSON.stringify(current.snapshot) !== JSON.stringify(listing.snapshot) || JSON.stringify(current.product?.specifications) !== JSON.stringify(listing.product?.specifications)) throw new Error("Product changed concurrently; retry repair");
        if (sourceRepair.changed) await tx.marketplaceListing.update({ where: { id: listing.id }, data: { snapshot: { ...snapshot, specifications: sourceRepair.value } as Prisma.InputJsonValue } });
        if (productRepair.changed && listing.productId) {
          await tx.product.update({ where: { id: listing.productId }, data: { specifications: productRepair.value as Prisma.InputJsonValue } });
          await tx.auditLog.create({ data: { action: "marketplace.specifications.repair", entityType: "Product", entityId: listing.productId, before: { specifications: listing.product!.specifications }, after: { specifications: productRepair.value } as Prisma.InputJsonValue } });
        }
      });
      repaired++;
      console.log(JSON.stringify({ mode: apply ? "applied" : "preview", productId: listing.productId, externalId: listing.externalId, specifications: productRepair.changed ? productRepair.value : sourceRepair.value, unresolvedLegacyFields: legacy(productRepair.value) || legacy(sourceRepair.value) }));
    }
  }
  if (apply && repaired) {
    const base = process.env.MARKETPLACE_APP_URL || "http://app:3000";
    const response = await fetch(`${base}/api/internal/catalog-invalidate/`, { method: "POST", headers: { Authorization: `Bearer ${catalogInvalidationToken()}` }, redirect: "error", signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("Data repaired; cache invalidation failed");
  }
  console.log(`${apply ? "Repaired" : "Would repair"} ${repaired} listings; publication, prices, availability and manual mode preserved.`);
} finally { await prisma.$disconnect(); }
