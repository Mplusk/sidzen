import type { Metadata } from "next";
import { CatalogView } from "@/components/catalog-view";
import type { CatalogParams } from "@/lib/catalog";

const metadata: Metadata = { title: "Каталог изделий 3D-печати", description: "Органайзеры, крепления, декор и прототипы с выбором материала и цвета.", alternates: { canonical: "/" } };

export async function generateMetadata({ searchParams }: { searchParams: Promise<CatalogParams> }): Promise<Metadata> {
  return { ...metadata, robots: Object.values(await searchParams).some(Boolean) ? { index: false, follow: true } : { index: true, follow: true } };
}
export default async function CatalogPage({ searchParams }: { searchParams: Promise<CatalogParams> }) {
  return <CatalogView searchParams={await searchParams} />;
}
