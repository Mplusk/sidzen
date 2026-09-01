import type { Metadata } from "next";
import { CatalogView } from "@/components/catalog-view";

export const metadata: Metadata = { title: "Поиск", robots: { index: false, follow: true } };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) { const params = await searchParams; return <CatalogView searchParams={{ q: params.q }} />; }
