import { Prisma } from "@prisma/client";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { filterValues, priceBound, searchTerms } from "@/lib/catalog-search";
import { productOptionInclude } from "@/lib/product-options-server";

export type CatalogParams = { category?: string; material?: string; technology?: string; color?: string; min?: string; max?: string; availability?: string; sort?: string; page?: string; q?: string };
export const getCatalogMenuCategories = unstable_cache(() => prisma.category.findMany({
  where: { visible: true, products: { some: { product: { status: "PUBLISHED", type: { in: ["READY", "PARAMETRIC"] } } } } },
  select: { slug: true, name: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
}), ["catalog-menu-v1"], { revalidate: 60, tags: ["catalog"] });
export function normalizeCatalogParams(input: Record<string, unknown>): CatalogParams {
  return Object.fromEntries(["category", "material", "technology", "color", "min", "max", "availability", "sort", "page", "q"].flatMap((key) => typeof input[key] === "string" ? [[key, (input[key] as string).slice(0, 160)]] : []));
}
export const getCatalog = unstable_cache(async (params: CatalogParams) => {
  const requestedPage = Math.min(10000, Math.max(1, Math.floor(Number(params.page) || 1))), take = 30;
  const min = priceBound(params.min), max = priceBound(params.max);
  const filters: Prisma.ProductWhereInput[] = (["material", "color", "technology"] as const).flatMap(kind => {
    const slugs = filterValues(params[kind]);
    if (!slugs.length) return [];
    const relation = kind === "material" ? "materials" : kind === "color" ? "colors" : "technologies";
    return [{ OR: [{ [relation]: { some: { active: true, slug: { in: slugs } } } }, { catalogFacets: { some: { kind, slug: { in: slugs } } } }] }];
  });
  const where: Prisma.ProductWhereInput = {
    status: "PUBLISHED", type: { in: ["READY", "PARAMETRIC"] },
    categories: { some: { category: { visible: true } } },
    ...(params.category ? { categories: { some: { category: { slug: params.category, visible: true } } } } : {}),
    ...(params.availability === "stock" ? { stock: { gt: 0 } } : {}),
    ...(min !== undefined || max !== undefined ? { basePrice: { gte: min, lte: max } } : {}),
    AND: [...filters, ...searchTerms(params.q ?? "").map((terms) => ({ OR: terms.flatMap((term) => [
      { name: { contains: term, mode: "insensitive" as const } }, { sku: { contains: term, mode: "insensitive" as const } },
      { shortDescription: { contains: term, mode: "insensitive" as const } }, { description: { contains: term, mode: "insensitive" as const } },
      { usage: { contains: term, mode: "insensitive" as const } }, { categories: { some: { category: { name: { contains: term, mode: "insensitive" as const } } } } },
    ]) }))],
  };
  const orderBy: Prisma.ProductOrderByWithRelationInput[] = [params.sort === "price-asc" ? { basePrice: "asc" } : params.sort === "price-desc" ? { basePrice: "desc" } : params.sort === "new" ? { publishedAt: "desc" } : { stock: "desc" }, { id: "asc" }];
  const count = await prisma.product.count({ where });
  const pages = Math.max(1, Math.ceil(count / take)), page = Math.min(requestedPage, pages);
  const visibleProducts = { status: "PUBLISHED" as const, type: { in: ["READY" as const, "PARAMETRIC" as const] }, categories: { some: { category: { visible: true, ...(params.category ? { slug: params.category } : {}) } } } };
  const include = { ...productOptionInclude, images: { orderBy: { sortOrder: "asc" as const }, take: 20 }, categories: { include: { category: true } } };
  const [products, categories, materials, technologies, colors, related, facets] = await Promise.all([
    prisma.product.findMany({ where, include, orderBy, skip: (page - 1) * take, take }),
    prisma.category.findMany({ where: { visible: true }, include: { _count: { select: { products: { where: { product: visibleProducts } } } } }, orderBy: { sortOrder: "asc" } }),
    prisma.material.findMany({ where: { active: true }, select: { slug: true, name: true, products: { where: visibleProducts, select: { id: true } } } }),
    prisma.technology.findMany({ where: { active: true }, select: { slug: true, name: true, products: { where: visibleProducts, select: { id: true } } } }),
    prisma.color.findMany({ where: { active: true }, select: { slug: true, name: true, products: { where: visibleProducts, select: { id: true } } } }),
    count ? Promise.resolve([]) : prisma.product.findMany({ where: visibleProducts, include, take: 4, orderBy: { stock: "desc" } }),
    prisma.catalogFacet.findMany({ select: { kind: true, slug: true, name: true, products: { where: visibleProducts, select: { id: true } } } }),
  ]);
  const merge = (kind: string, legacy: typeof materials) => {
    const values = new Map<string, { slug: string; name: string; ids: Set<string> }>();
    for (const item of [...facets.filter(facet => facet.kind === kind), ...legacy]) {
      const previous = values.get(item.slug) ?? { slug: item.slug, name: item.name, ids: new Set<string>() };
      for (const row of item.products) previous.ids.add(row.id);
      values.set(item.slug, previous);
    }
    return [...values.values()].filter(item => item.ids.size || filterValues(params[kind as keyof CatalogParams]).includes(item.slug)).map(item => ({ slug: item.slug, name: item.name, _count: { products: item.ids.size } })).sort((a, b) => a.name.localeCompare(b.name, "ru"));
  };
  return { products, count, categories, materials: merge("material", materials), technologies: merge("technology", technologies), colors: merge("color", colors), related, page, pages, pageSize: take };
}, ["catalog-v5"], { revalidate: 60, tags: ["catalog"] });
