import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { defaultProductPrice } from "./product-options";
import { productOptionInclude, productOptions } from "./product-options-server";

// Used only for price filtering/sorting; ordinary catalog pages keep database
// pagination. Apply visibility/search/facet predicates in SQL first, then price
// small batches without fetching images or full product descriptions. Only the
// ID/price index is retained, not every full product/configuration in memory.
export async function getCatalogPricePage({ where, orderBy, min, max, descending, page, pageSize }: {
  where: Prisma.ProductWhereInput;
  orderBy: Prisma.ProductOrderByWithRelationInput[];
  min?: number;
  max?: number;
  descending?: boolean;
  page: number;
  pageSize: number;
}) {
  const matches: Array<{ id: string; price: number }> = [];
  let cursor: string | undefined;
  const priceSort = descending !== undefined;
  while (true) {
    const batch = await prisma.product.findMany({
      where, orderBy: priceSort ? [{ id: "asc" }] : orderBy,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), take: 200,
      select: { ...productOptionInclude, id: true, name: true, basePrice: true, weightGrams: true, stock: true, reservedStock: true, madeToOrder: true },
    });
    for (const row of batch) {
      const price = defaultProductPrice(productOptions(row));
      if ((min === undefined || price >= min) && (max === undefined || price <= max)) matches.push({ id: row.id, price });
    }
    if (batch.length < 200) break;
    cursor = batch[batch.length - 1].id;
  }
  // Stable sorting preserves ascending ID order when public prices are equal.
  if (priceSort) matches.sort((a, b) => descending ? b.price - a.price : a.price - b.price);
  const count = matches.length, pages = Math.max(1, Math.ceil(count / pageSize));
  const currentPage = Math.min(page, pages);
  return { count, pages, page: currentPage, ids: matches.slice((currentPage - 1) * pageSize, currentPage * pageSize).map(row => row.id) };
}
