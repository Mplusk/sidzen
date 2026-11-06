import type { Metadata } from "next";
import { CatalogView } from "@/components/catalog-view";
import { getCatalog, type CatalogParams } from "@/lib/catalog";
import { catalogIndexing } from "@/lib/seo";

const metadata: Metadata = { title: "Каталог изделий 3D-печати", description: "Декор для дома, светильники и полезные аксессуары SIDZEN. Изделия 3D-печати с доставкой по России.", alternates: { canonical: "/" } };

export async function generateMetadata({ searchParams }: { searchParams: Promise<CatalogParams> }): Promise<Metadata> {
  const params = await searchParams;
  const { canonical, filtered } = catalogIndexing("/", params);
  const outOfRange = !filtered && canonical.includes("?page=") && Number(params.page) > (await getCatalog({ page: params.page })).pages;
  return { ...metadata, alternates: { canonical: outOfRange ? "/" : canonical }, robots: { index: !filtered && !outOfRange, follow: true } };
}
export default async function CatalogPage({ searchParams }: { searchParams: Promise<CatalogParams> }) {
  return <CatalogView searchParams={await searchParams} />;
}
