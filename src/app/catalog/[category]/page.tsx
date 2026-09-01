import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CatalogView } from "@/components/catalog-view";
import type { CatalogParams } from "@/lib/catalog";
import { prisma } from "@/lib/prisma";

export async function generateMetadata({ params }: { params: Promise<{ category: string }> }): Promise<Metadata> {
  const { category: slug } = await params;
  const category = await prisma.category.findUnique({ where: { slug } });
  if (!category) return {};
  return { title: category.title ?? category.name, description: category.metaDescription ?? category.description, alternates: { canonical: `/catalog/${category.slug}/` }, robots: category.robots };
}

export default async function CategoryPage({ params, searchParams }: { params: Promise<{ category: string }>; searchParams: Promise<CatalogParams> }) {
  const { category: slug } = await params;
  const category = await prisma.category.findUnique({ where: { slug } });
  if (!category) notFound();
  return <CatalogView category={category} searchParams={await searchParams} />;
}
