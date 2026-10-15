import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ProductCard } from "@/components/product-card";
import { prisma } from "@/lib/prisma";
import { getStoreContacts } from "@/lib/settings";
import { requestPublicReviewWhere } from "@/lib/review-visibility";
import { productOptionInclude } from "@/lib/product-options-server";
export const metadata: Metadata = { title: "О SIDZEN", description: "SIDZEN — природные формы, цифровое производство и предметы для дома.", alternates: { canonical: "/about/" } };
export default async function AboutPage() {
  const publicReviewWhere = await requestPublicReviewWhere();
  const contacts = await getStoreContacts();
  const [products, reviews] = await Promise.all([
    prisma.product.findMany({ where: { status: "PUBLISHED", type: { in: ["READY", "PARAMETRIC"] } }, include: { ...productOptionInclude, images: true, categories: { include: { category: true } } }, take: 4 }),
    prisma.review.findMany({ where: { ...publicReviewWhere, product: { status: "PUBLISHED", type: { in: ["READY", "PARAMETRIC"] } } }, select: { id: true, rating: true, author: true, text: true, product: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 6 }),
  ]);
  return <div className="container shop-page"><Breadcrumbs items={[{ label: "О магазине", href: "/about/" }]} /><div className="rich-text"><span className="eyebrow">SIDZEN · 3D декор для дома</span><h1>Природные формы.<br />Предметы для жизни.</h1><p>SIDZEN соединяет органичные формы и цифровое производство. Мы выбираем спокойные силуэты и выразительную фактуру — для небольших деталей, которые делают пространство вашим.</p><p>Слои 3D-печати — часть характера предмета. В каталоге можно выбрать декор, свет и полезные вещи для дома, рассмотреть фотографии и подобрать доступный цвет.</p>{contacts.about && <p style={{ whiteSpace: "pre-line" }}>{contacts.about}</p>}<p>Условия использования зависят от конкретного материала и конструкции. Изучите характеристики товара и <Link className="text-link" href="/materials/">справочник материалов</Link> перед покупкой.</p></div><h2>Изделия из каталога</h2><div className="product-grid">{products.map((product) => <ProductCard key={product.id} product={product} />)}</div><h2>Отзывы покупателей</h2>{reviews.length ? <div className="content-grid">{reviews.map((review) => <article className="content-card" key={review.id}><h3>{review.product.name}</h3><p>{review.text}</p><small>{review.author} · {review.rating}/5</small></article>)}</div> : <p>Опубликованных отзывов пока нет.</p>}<p><Link className="text-link" href="/contacts/">Контакты и реквизиты продавца</Link></p></div>;
}
