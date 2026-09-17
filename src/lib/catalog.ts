import { Prisma } from "@prisma/client";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { filterValues, priceBound, searchTerms } from "@/lib/catalog-search";
import { productOptionInclude } from "@/lib/product-options-server";

export type CatalogParams = { category?: string; material?: string; technology?: string; color?: string; min?: string; max?: string; availability?: string; sort?: string; page?: string; q?: string };
export function normalizeCatalogParams(input: Record<string, unknown>): CatalogParams {
  return Object.fromEntries(["category", "material", "technology", "color", "min", "max", "availability", "sort", "page", "q"].flatMap((key) => typeof input[key] === "string" ? [[key, (input[key] as string).slice(0, 160)]] : []));
}
export const getCatalog = unstable_cache(async (params: CatalogParams) => {
  const requestedPage = Math.min(10000, Math.max(1, Math.floor(Number(params.page) || 1))), take = 12;
  const min = priceBound(params.min), max = priceBound(params.max);
  const where: Prisma.ProductWhereInput = {
    status: "PUBLISHED", type: { not: "PRINT_TEMPLATE" },
    ...(params.category ? { categories: { some: { category: { slug: params.category, visible: true } } } } : {}),
    ...(filterValues(params.material).length ? { materials: { some: { active: true, slug: { in: filterValues(params.material) } } } } : {}),
    ...(filterValues(params.technology).length ? { technologies: { some: { active: true, slug: { in: filterValues(params.technology) } } } } : {}),
    ...(filterValues(params.color).length ? { colors: { some: { active: true, slug: { in: filterValues(params.color) } } } } : {}),
    ...(params.availability === "stock" ? { stock: { gt: 0 } } : {}),
    ...(min !== undefined || max !== undefined ? { basePrice: { gte: min, lte: max } } : {}),
    ...(params.q?.trim() ? { AND: searchTerms(params.q).map((terms) => ({ OR: terms.flatMap((term) => [
      { name: { contains: term, mode: "insensitive" as const } }, { sku: { contains: term, mode: "insensitive" as const } },
      { shortDescription: { contains: term, mode: "insensitive" as const } }, { description: { contains: term, mode: "insensitive" as const } },
      { usage: { contains: term, mode: "insensitive" as const } }, { categories: { some: { category: { name: { contains: term, mode: "insensitive" as const } } } } },
    ]) })) } : {}),
  };
  const orderBy: Prisma.ProductOrderByWithRelationInput[] = [params.sort === "price-asc" ? { basePrice: "asc" } : params.sort === "price-desc" ? { basePrice: "desc" } : params.sort === "new" ? { publishedAt: "desc" } : { stock: "desc" }, { id: "asc" }];
  const count = await prisma.product.count({ where });
  const pages = Math.max(1, Math.ceil(count / take)), page = Math.min(requestedPage, pages);
  const visibleProducts = { status: "PUBLISHED" as const, type: { not: "PRINT_TEMPLATE" as const } };
  const include = { ...productOptionInclude, images: { orderBy: { sortOrder: "asc" as const }, take: 20 }, categories: { include: { category: true } } };
  const [products, categories, materials, technologies, colors, suggestions, related] = await Promise.all([
    prisma.product.findMany({ where, include, orderBy, skip: (page - 1) * take, take }),
    prisma.category.findMany({ where: { visible: true }, include: { _count: { select: { products: { where: { product: visibleProducts } } } } }, orderBy: { sortOrder: "asc" } }),
    prisma.material.findMany({ where: { active: true }, include: { _count: { select: { products: { where: visibleProducts } } } }, orderBy: { name: "asc" } }),
    prisma.technology.findMany({ where: { active: true }, include: { _count: { select: { products: { where: visibleProducts } } } }, orderBy: { name: "asc" } }),
    prisma.color.findMany({ where: { active: true }, include: { _count: { select: { products: { where: visibleProducts } } } }, orderBy: { name: "asc" } }),
    prisma.product.findMany({ where: visibleProducts, select: { name: true }, take: 50, orderBy: { stock: "desc" } }),
    count ? Promise.resolve([]) : prisma.product.findMany({ where: visibleProducts, include, take: 4, orderBy: { stock: "desc" } }),
  ]);
  return { products, count, categories, materials, technologies, colors, suggestions, related, page, pages };
}, ["catalog-v2"], { revalidate: 60, tags: ["catalog"] });
