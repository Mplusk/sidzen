import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ProductCard } from "@/components/product-card";
import { prisma } from "@/lib/prisma";
import { getStoreContacts } from "@/lib/settings";
export const metadata: Metadata = { title: "О магазине", description: "Каталог 3DPRINTA: изделия, материалы и выбор параметров покупки.", alternates: { canonical: "/about/" } };
export default async function AboutPage() {
  const contacts = await getStoreContacts();
  const [products, reviews] = await Promise.all([
    prisma.product.findMany({ where: { status: "PUBLISHED", type: { not: "PRINT_TEMPLATE" } }, include: { images: true, categories: { include: { category: true } } }, take: 4 }),
    prisma.review.findMany({ where: { approved: true, product: { status: "PUBLISHED", type: { not: "PRINT_TEMPLATE" } } }, include: { product: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 6 }),
  ]);
  return <div className="container shop-page"><Breadcrumbs items={[{ label: "О магазине", href: "/about/" }]} /><div className="rich-text"><h1>О магазине 3DPRINTA</h1><p>3DPRINTA — интернет-магазин изделий, изготовленных с помощью 3D-печати. Здесь можно выбрать товар, настроить доступные материал, цвет и качество, добавить покупку в корзину и оформить доставку.</p>{contacts.about && <p style={{ whiteSpace: "pre-line" }}>{contacts.about}</p>}<p>Магазин работает с изделиями из каталога. Загрузка пользовательских 3D-моделей и индивидуальный расчёт печати не предлагаются.</p><p>Условия использования зависят от конкретного материала и конструкции. Изучите характеристики товара и <Link className="text-link" href="/materials/">справочник материалов</Link> перед покупкой.</p></div><h2>Изделия из каталога</h2><div className="product-grid">{products.map((product) => <ProductCard key={product.id} product={product} />)}</div><h2>Отзывы покупателей</h2>{reviews.length ? <div className="content-grid">{reviews.map((review) => <article className="content-card" key={review.id}><h3>{review.product.name}</h3><p>{review.text}</p><small>{review.author} · {review.rating}/5</small></article>)}</div> : <p>Опубликованных отзывов пока нет.</p>}<p><Link className="text-link" href="/contacts/">Контакты и реквизиты продавца</Link></p></div>;
}
