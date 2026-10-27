import { unstable_cache } from "next/cache";
import { prisma } from "./prisma";
import { searchTerms } from "./catalog-search";
import { productOptionInclude, productOptions } from "./product-options-server";
import { defaultProductPrice } from "./product-options";
export const getCatalogSuggestions = unstable_cache(async (query: string) => {
  const terms = searchTerms(query);
  if (!terms.length || query.trim().length < 2) return [];
  const rows = await prisma.product.findMany({
    where: { status: "PUBLISHED", type: { in: ["READY", "PARAMETRIC"] }, categories: { some: { category: { visible: true } } }, AND: terms.map(words => ({ OR: words.flatMap(word => [
      { name: { contains: word, mode: "insensitive" as const } }, { sku: { contains: word, mode: "insensitive" as const } },
      { shortDescription: { contains: word, mode: "insensitive" as const } }, { description: { contains: word, mode: "insensitive" as const } },
      { usage: { contains: word, mode: "insensitive" as const } }, { categories: { some: { category: { name: { contains: word, mode: "insensitive" as const } } } } },
    ]) })) },
    select: { ...productOptionInclude, id: true, name: true, slug: true, basePrice: true, weightGrams: true, stock: true, madeToOrder: true, images: { orderBy: { sortOrder: "asc" }, take: 1, select: { path: true } }, categories: { where: { category: { visible: true } }, orderBy: { isPrimary: "desc" }, take: 1, select: { category: { select: { slug: true } } } } },
    orderBy: [{ stock: "desc" }, { id: "asc" }], take: 6,
  });
  return rows.map(row => ({ id: row.id, name: row.name, price: defaultProductPrice(productOptions(row)), image: row.images[0]?.path ?? null, href: `/catalog/${row.categories[0].category.slug}/${row.slug}/` }));
}, ["catalog-suggestions-v4"], { revalidate: 60, tags: ["catalog"] });
