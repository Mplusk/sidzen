import { Prisma, PublicationStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type CatalogParams = {
  category?: string;
  material?: string;
  technology?: string;
  color?: string;
  min?: string;
  max?: string;
  availability?: string;
  sort?: string;
  page?: string;
  q?: string;
};

export async function getCatalog(params: CatalogParams) {
  const page = Math.max(1, Number(params.page) || 1);
  const take = 12;
  const where: Prisma.ProductWhereInput = {
    status: PublicationStatus.PUBLISHED,
    ...(params.category ? { categories: { some: { category: { slug: params.category } } } } : {}),
    ...(params.material ? { materials: { some: { slug: params.material } } } : {}),
    ...(params.technology ? { technologies: { some: { slug: params.technology } } } : {}),
    ...(params.color ? { colors: { some: { slug: params.color } } } : {}),
    ...(params.availability === "stock" ? { stock: { gt: 0 } } : {}),
    ...(params.min || params.max ? { basePrice: { ...(params.min ? { gte: Number(params.min) } : {}), ...(params.max ? { lte: Number(params.max) } : {}) } } : {}),
    ...(params.q ? { OR: [{ name: { contains: params.q, mode: "insensitive" } }, { sku: { contains: params.q, mode: "insensitive" } }, { shortDescription: { contains: params.q, mode: "insensitive" } }] } : {}),
  };
  const orderBy: Prisma.ProductOrderByWithRelationInput =
    params.sort === "price-asc" ? { basePrice: "asc" } :
    params.sort === "price-desc" ? { basePrice: "desc" } :
    params.sort === "new" ? { publishedAt: "desc" } :
    { stock: "desc" };

  const [products, count, categories, materials, technologies, colors] = await Promise.all([
    prisma.product.findMany({ where, include: { images: { orderBy: { sortOrder: "asc" }, take: 20 }, categories: { include: { category: true } } }, orderBy, skip: (page - 1) * take, take }),
    prisma.product.count({ where }),
    prisma.category.findMany({ where: { visible: true }, orderBy: { sortOrder: "asc" } }),
    prisma.material.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.technology.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    prisma.color.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);
  return { products, count, categories, materials, technologies, colors, page, pages: Math.max(1, Math.ceil(count / take)) };
}
