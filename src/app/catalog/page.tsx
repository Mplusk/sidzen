import type { Metadata } from "next";
import { CatalogView } from "@/components/catalog-view";
import type { CatalogParams } from "@/lib/catalog";

export const metadata: Metadata = { title: "Каталог изделий 3D-печати", description: "Органайзеры, крепления, декор и прототипы с выбором материала и цвета.", alternates: { canonical: "/catalog/" } };

export default async function CatalogPage({ searchParams }: { searchParams: Promise<CatalogParams> }) {
  return <CatalogView searchParams={await searchParams} />;
}
