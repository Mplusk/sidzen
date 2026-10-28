import type { Metadata } from "next";
import Link from "next/link";
import { ProductCard } from "@/components/product-card";
import { getFavoriteIds, favoriteProductWhere } from "@/lib/favorites-server";
import { productOptionInclude } from "@/lib/product-options-server";
import { prisma } from "@/lib/prisma";
export const metadata: Metadata = { title: "Избранное", robots: { index: false, follow: false } };
export default async function FavoritesPage() {
  const ids = await getFavoriteIds();
  const rows = ids.length ? await prisma.product.findMany({ where: { ...favoriteProductWhere, id: { in: ids } }, include: { ...productOptionInclude, images: { orderBy: { sortOrder: "asc" } }, categories: { include: { category: true } } } }) : [];
  const products = ids.flatMap(id => rows.filter(row => row.id === id));
  return <section className="container shop-page favorites-page"><h1>Избранное</h1><p className="muted">Сохраняйте понравившиеся товары нажатием на сердечко. Без входа список хранится в этом браузере до 30 дней; после входа — в вашей учётной записи.</p>{products.length ? <div className="product-grid">{products.map((product, index) => <ProductCard key={product.id} product={product} highPriority={index === 0} />)}</div> : <div className="empty-state"><h2>Пока ничего не сохранено</h2><p>Нажмите на сердечко рядом с понравившимся товаром.</p><Link href="/catalog/" className="button">Перейти в каталог</Link></div>}</section>;
}
