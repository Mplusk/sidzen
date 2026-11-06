import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CatalogView } from "@/components/catalog-view";
import { getCatalog, type CatalogParams } from "@/lib/catalog";
import { prisma } from "@/lib/prisma";
import { catalogIndexing, normalizePageTitle } from "@/lib/seo";

export async function generateMetadata({ params, searchParams }: { params: Promise<{ category: string }>; searchParams: Promise<CatalogParams> }): Promise<Metadata> {
  const { category: slug } = await params;
  const category = await prisma.category.findUnique({ where: { slug } });
  if (!category?.visible) return {};
  const query = await searchParams;
  const base = `/catalog/${category.slug}/`;
  const { canonical, filtered } = catalogIndexing(base, query);
  const outOfRange = !filtered && canonical.includes("?page=") && Number(query.page) > (await getCatalog({ category: category.slug, page: query.page })).pages;
  return { title: normalizePageTitle(category.title ?? category.name), description: category.metaDescription ?? category.description, alternates: { canonical: outOfRange ? base : canonical }, robots: filtered || outOfRange ? { index: false, follow: true } : category.robots };
}

export default async function CategoryPage({ params, searchParams }: { params: Promise<{ category: string }>; searchParams: Promise<CatalogParams> }) {
  const { category: slug } = await params;
  const category = await prisma.category.findUnique({ where: { slug } });
  if (!category?.visible) notFound();
  return <CatalogView category={category} searchParams={await searchParams} />;
}
