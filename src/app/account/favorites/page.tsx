import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ProductCard } from "@/components/product-card";
import { productOptionInclude } from "@/lib/product-options-server";

export const metadata: Metadata = { title: "Избранное", robots: { index: false, follow: false } };

export default async function FavoritesPage() {
  const user = await requireUser();
  const items = await prisma.productFavorite.findMany({ where: { userId: user.id }, include: { product: { include: { ...productOptionInclude, images: true, categories: { include: { category: true } } } } } });
  return <><span className="eyebrow">Список</span><h1>Избранное</h1>{items.length ? <div className="product-grid">{items.map((item) => <ProductCard key={item.productId} product={item.product} />)}</div> : <div className="empty-state">Сохранённых товаров пока нет.</div>}</>;
}
