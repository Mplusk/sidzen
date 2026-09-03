import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = "https://3dprinta.shop";
  const [categories, products] = await Promise.all([
    prisma.category.findMany({ where: { visible: true }, select: { slug: true, updatedAt: true } }),
    prisma.product.findMany({ where: { status: "PUBLISHED" }, select: { slug: true, updatedAt: true, categories: { where: { isPrimary: true }, select: { category: { select: { slug: true } } }, take: 1 } } }),
  ]);
  return [
    { url: `${base}/catalog/`, lastModified: new Date(), changeFrequency: "daily" as const, priority: 1 },
    ...categories.map((item) => ({ url: `${base}/catalog/${item.slug}/`, lastModified: item.updatedAt, changeFrequency: "weekly" as const, priority: .8 })),
    ...products.map((item) => ({ url: `${base}/catalog/${item.categories[0]?.category.slug ?? "products"}/${item.slug}/`, lastModified: item.updatedAt, changeFrequency: "weekly" as const, priority: .9 })),
  ];
}
