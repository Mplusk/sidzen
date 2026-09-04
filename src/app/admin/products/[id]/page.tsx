import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminProductForm, type ProductFormOptions, type ProductFormValue } from "@/components/admin-product-form";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Редактирование товара", robots: { index: false, follow: false } };

export default async function AdminProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ saved?: string; created?: string; error?: string }> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const [product, categories, materials, colors, technologies, qualityProfiles, postProcesses] = await Promise.all([
    prisma.product.findUnique({ where: { id }, include: { categories: { orderBy: { isPrimary: "desc" }, include: { category: { select: { slug: true } } } }, images: { orderBy: { sortOrder: "asc" } }, materials: { select: { id: true } }, colors: { select: { id: true } }, technologies: { select: { id: true } }, qualityProfiles: { select: { id: true } }, postProcesses: { select: { id: true } } } }),
    prisma.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.material.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.color.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, hex: true } }),
    prisma.technology.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.qualityProfile.findMany({ orderBy: { layerHeightMm: "desc" }, select: { id: true, name: true, layerHeightMm: true } }),
    prisma.postProcessOption.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, price: true } }),
  ]);
  if (!product) notFound();

  const options: ProductFormOptions = {
    categories,
    materials,
    colors,
    technologies,
    qualityProfiles: qualityProfiles.map((item) => ({ ...item, layerHeightMm: Number(item.layerHeightMm) })),
    postProcesses: postProcesses.map((item) => ({ ...item, price: Number(item.price) })),
  };
  const primaryCategory = product.categories.find((item) => item.isPrimary) ?? product.categories[0];
  const value: ProductFormValue = {
    ...product,
    basePrice: Number(product.basePrice),
    oldPrice: product.oldPrice == null ? null : Number(product.oldPrice),
    costPrice: product.costPrice == null ? null : Number(product.costPrice),
    weightGrams: product.weightGrams == null ? null : Number(product.weightGrams),
    widthMm: product.widthMm == null ? null : Number(product.widthMm),
    depthMm: product.depthMm == null ? null : Number(product.depthMm),
    heightMm: product.heightMm == null ? null : Number(product.heightMm),
    robots: product.robots as ProductFormValue["robots"],
    primaryCategoryId: primaryCategory?.categoryId ?? categories[0]?.id ?? "",
    categoryIds: product.categories.map((item) => item.categoryId),
    materialIds: product.materials.map((item) => item.id),
    colorIds: product.colors.map((item) => item.id),
    technologyIds: product.technologies.map((item) => item.id),
    qualityProfileIds: product.qualityProfiles.map((item) => item.id),
    postProcessIds: product.postProcesses.map((item) => item.id),
  };
  const publicHref = primaryCategory && product.status === "PUBLISHED" ? `/catalog/${primaryCategory.category.slug}/${product.slug}/` : null;

  return <><div className="admin-header"><div><span className="eyebrow">{product.sku}</span><h1>{product.name}</h1></div><div className="admin-header__actions"><Link className="button button--outline" href="/admin/products/">К списку</Link>{publicHref && <Link className="button button--outline" href={publicHref} target="_blank">Открыть на сайте</Link>}</div></div>{(query.saved || query.created) && <p className="notice notice--success">Изменения сохранены.</p>}<AdminProductForm options={options} product={value} error={query.error} /></>;
}
