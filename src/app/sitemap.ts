import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { allowsIndexing, isOwnCanonical, primaryVisibleCategorySlug } from "@/lib/seo";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = "https://sidzen.shop";
  const [categories, products] = await Promise.all([
    prisma.category.findMany({ where: { visible: true }, select: { slug: true, updatedAt: true, robots: true } }),
    prisma.product.findMany({
      where: { status: "PUBLISHED", type: { in: ["READY", "PARAMETRIC"] }, categories: { some: { category: { visible: true } } } },
      select: { slug: true, updatedAt: true, robots: true, canonical: true, categories: { where: { category: { visible: true } }, select: { isPrimary: true, category: { select: { slug: true, visible: true } } } } },
    }),
  ]);
  return [
    { url: `${base}/` },
    ...["about", "contacts", "delivery", "materials", "faq"].map(path => ({ url: `${base}/${path}/` })),
    ...categories.filter(item => allowsIndexing(item.robots)).map(item => ({ url: `${base}/catalog/${item.slug}/`, lastModified: item.updatedAt })),
    ...products.flatMap(item => {
      const category = primaryVisibleCategorySlug(item.categories);
      if (!category || !allowsIndexing(item.robots)) return [];
      const path = `/catalog/${category}/${item.slug}/`;
      return isOwnCanonical(item.canonical, path, base) ? [{ url: base + path, lastModified: item.updatedAt }] : [];
    }),
  ];
}
