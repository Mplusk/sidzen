import type { Metadata } from "next";
import Link from "next/link";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { prisma } from "@/lib/prisma";
import { getStoreContacts } from "@/lib/settings";
import { requestPublicReviewWhere } from "@/lib/review-visibility";
export const metadata: Metadata = { title: "О SIDZEN", description: "SIDZEN — природные формы, цифровое производство и предметы для дома.", alternates: { canonical: "/about/" } };
export default async function AboutPage() {
  const publicReviewWhere = await requestPublicReviewWhere();
  const contacts = await getStoreContacts();
  const reviews = await prisma.review.findMany({ where: { ...publicReviewWhere, product: { status: "PUBLISHED", type: { in: ["READY", "PARAMETRIC"] } } }, select: { id: true, rating: true, author: true, text: true, product: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 6 });
  return (
    <article className="container about-page">
      <Breadcrumbs items={[{ label: "О магазине", href: "/about/" }]} />
      <div className="about-story">
        <header className="about-story__heading">
          <h1>Природные формы.<br /><span>Предметы для жизни.</span></h1>
        </header>
        <div className="about-story__body">
          <p className="about-story__lead">SIDZEN соединяет органичные формы и цифровое производство. Мы выбираем спокойные силуэты и выразительную фактуру — для небольших деталей, которые делают пространство вашим.</p>
          <p>Слои 3D-печати — часть характера предмета. В каталоге можно выбрать декор, свет и полезные вещи для дома, рассмотреть фотографии и подобрать доступный цвет.</p>
          {contacts.about && <p className="about-story__copy">{contacts.about}</p>}
          <p className="about-story__note">Условия использования зависят от конкретного материала и конструкции. Изучите характеристики товара и <Link className="text-link" href="/materials/">справочник материалов</Link> перед покупкой.</p>
        </div>
      </div>
      <section className="about-reviews" aria-labelledby="about-reviews-heading">
        <h2 id="about-reviews-heading">Отзывы покупателей</h2>
        {reviews.length ? <div className="about-reviews__grid">{reviews.map((review) => <article className="about-review" key={review.id}><h3>{review.product.name}</h3><p>{review.text}</p><small>{review.author} · {review.rating}/5</small></article>)}</div> : <p className="about-reviews__empty">Опубликованных отзывов пока нет.</p>}
      </section>
    </article>
  );
}
