import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = "https://sidzen.shop";
  const [categories, products] = await Promise.all([
    prisma.category.findMany({ where: { visible: true }, select: { slug: true, updatedAt: true } }),
    prisma.product.findMany({ where: { status: "PUBLISHED", type: { in: ["READY", "PARAMETRIC"] } }, select: { slug: true, updatedAt: true, categories: { where: { isPrimary: true }, select: { category: { select: { slug: true } } }, take: 1 } } }),
  ]);
  return [
    { url: `${base}/`, lastModified: new Date(), changeFrequency: "daily" as const, priority: 1 },
    ...["about", "contacts", "delivery", "materials", "faq"].map((path) => ({ url: `${base}/${path}/`, changeFrequency: "monthly" as const, priority: .5 })),
    ...categories.map((item) => ({ url: `${base}/catalog/${item.slug}/`, lastModified: item.updatedAt, changeFrequency: "weekly" as const, priority: .8 })),
    ...products.map((item) => ({ url: `${base}/catalog/${item.categories[0]?.category.slug ?? "products"}/${item.slug}/`, lastModified: item.updatedAt, changeFrequency: "weekly" as const, priority: .9 })),
  ];
}
