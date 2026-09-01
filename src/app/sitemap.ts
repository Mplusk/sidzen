import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = "https://3dprinta.shop";
  const [categories, products, materials, technologies, articles] = await Promise.all([
    prisma.category.findMany({ where: { visible: true }, select: { slug: true, updatedAt: true } }),
    prisma.product.findMany({ where: { status: "PUBLISHED" }, select: { slug: true, updatedAt: true, categories: { where: { isPrimary: true }, select: { category: { select: { slug: true } } }, take: 1 } } }),
    prisma.material.findMany({ where: { active: true }, select: { slug: true } }),
    prisma.technology.findMany({ where: { active: true }, select: { slug: true } }),
    prisma.article.findMany({ where: { status: "PUBLISHED" }, select: { slug: true, updatedAt: true, rubric: { select: { slug: true } } } }),
  ]);
  const staticPages = ["", "/catalog/", "/print/", "/materials/", "/technologies/", "/blog/", "/faq/", "/delivery/", "/about/", "/contacts/"].map((path) => ({ url: `${base}${path}`, lastModified: new Date(), changeFrequency: path === "" ? "daily" as const : "weekly" as const, priority: path === "" ? 1 : .7 }));
  return [...staticPages, ...categories.map((item) => ({ url: `${base}/catalog/${item.slug}/`, lastModified: item.updatedAt, changeFrequency: "weekly" as const, priority: .8 })), ...products.map((item) => ({ url: `${base}/catalog/${item.categories[0]?.category.slug ?? "products"}/${item.slug}/`, lastModified: item.updatedAt, changeFrequency: "weekly" as const, priority: .9 })), ...materials.map((item) => ({ url: `${base}/materials/${item.slug}/`, changeFrequency: "monthly" as const, priority: .7 })), ...technologies.map((item) => ({ url: `${base}/technologies/${item.slug}/`, changeFrequency: "monthly" as const, priority: .7 })), ...articles.map((item) => ({ url: `${base}/blog/${item.rubric.slug}/${item.slug}/`, lastModified: item.updatedAt, changeFrequency: "monthly" as const, priority: .7 }))];
}
