import type { Metadata } from "next";
import Link from "next/link";
import { AdminProductForm, type ProductFormOptions } from "@/components/admin-product-form";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { getCategoryAiConfig, categoryAiReady } from "@/lib/category-ai/config";

export const metadata: Metadata = { title: "Новый товар", robots: { index: false, follow: false } };

export default async function NewProductPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requirePermission(PERMISSIONS.productsWrite);
  const [query, categories, materials, colors, technologies, qualityProfiles, postProcesses] = await Promise.all([
    searchParams,
    prisma.category.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.material.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.color.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, hex: true } }),
    prisma.technology.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.qualityProfile.findMany({ where: { active: true }, orderBy: { layerHeightMm: "desc" }, select: { id: true, name: true, layerHeightMm: true } }),
    prisma.postProcessOption.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, price: true } }),
  ]);
  const options: ProductFormOptions = {
    categories,
    materials,
    colors,
    technologies,
    qualityProfiles: qualityProfiles.map((item) => ({ ...item, layerHeightMm: Number(item.layerHeightMm) })),
    postProcesses: postProcesses.map((item) => ({ ...item, price: Number(item.price) })),
  };

  const aiReady = categoryAiReady(await getCategoryAiConfig());
  return <><div className="admin-header"><div><span className="eyebrow">Каталог</span><h1>Новый товар</h1></div><Link className="button button--outline" href="/admin/products/">К списку</Link></div><AdminProductForm options={options} aiReady={aiReady} error={query.error} canPublish={user.permissions.has(PERMISSIONS.productsPublish) || user.roles.includes("superadmin")} /></>;
}
