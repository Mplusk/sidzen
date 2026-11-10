import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Return only product IDs; legacy orders and customer data never leave the server. */
export async function legacyStockReviewProductIds(ids: string[], db: Pick<Prisma.TransactionClient, "orderItem"> = prisma) {
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length) return new Set<string>();
  const rows = await db.orderItem.findMany({
    where: { productId: { in: uniqueIds }, order: { inventoryTracked: false } },
    select: { productId: true },
    distinct: ["productId"],
  });
  return new Set(rows.flatMap(row => row.productId ? [row.productId] : []));
}

