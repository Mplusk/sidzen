import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { operatorReady } from "@/lib/privacy";
import { purchasedProductWhere, reviewPage, reviewStatusLabel } from "@/lib/reviews";
import { requestPublicReviewWhere } from "@/lib/review-visibility";
import { ReviewCard } from "@/components/review-card";
import { ReviewForm } from "@/components/review-form";
import { reviewTransferApproved } from "@/lib/review-ai/config";

export async function ProductReviews({ productId, path, total, rating, requestedPage }: { productId: string; path: string; total: number; rating: number; requestedPage?: string }) {
  const publicReviewWhere = await requestPublicReviewWhere();
  const user = await getCurrentUser(), { page, pages } = reviewPage(requestedPage, total);
  const [reviews, own, purchase, ready] = await Promise.all([
    prisma.review.findMany({ where: { productId, ...publicReviewWhere }, select: { id: true, author: true, text: true, rating: true, createdAt: true, verifiedPurchase: true, images: { select: { id: true, width: true, height: true }, orderBy: { sortOrder: "asc" } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * 10, take: 10 }),
    user ? prisma.review.findFirst({ where: { productId, userId: user.id }, select: { status: true } }) : null,
    user ? prisma.order.findFirst({ where: purchasedProductWhere(user.id, productId), select: { id: true } }) : null,
    operatorReady(),
  ]);
  return <section className="product-reviews ym-hide-content ym-disable-keys" aria-labelledby="reviews-heading">
    <div className="reviews-heading"><h2 id="reviews-heading">Отзывы покупателей <span className="muted">{total}</span></h2>{total > 0 && <strong className="reviews-average">★ {rating.toFixed(1)} <small>из 5</small></strong>}</div>
    {!user ? <p className="notice">Отзывы доступны всем. <Link className="text-link" href={`/login/?returnTo=${encodeURIComponent(`${path}#reviews-heading`)}`}>Войдите</Link>, чтобы оставить отзыв о купленном товаре.</p>
      : own ? <p className="notice">Ваш отзыв: {reviewStatusLabel(own.status).toLowerCase()}. <Link className="text-link" href="/account/reviews/">Открыть мои отзывы</Link></p>
      : !purchase ? <p className="notice">Оставить отзыв можно после оплаты и получения этого товара в заказе вашего аккаунта. Читать отзывы можно без покупки.</p>
      : !ready ? <p className="notice">Приём отзывов временно недоступен: магазин ещё не настроил обработку данных.</p>
      : <details className="review-compose"><summary>Написать отзыв о купленном товаре</summary><ReviewForm productId={productId} allowAi={reviewTransferApproved()} /></details>}
    {reviews.length ? reviews.map(review => <ReviewCard key={review.id} review={review} />) : <p className="muted">Опубликованных отзывов пока нет. Поделитесь впечатлениями после получения товара.</p>}
    {pages > 1 && <nav className="pagination" aria-label="Страницы отзывов">{page > 1 && <Link href={`${path}?reviewsPage=${page - 1}#reviews-heading`}>← Предыдущие отзывы</Link>}<span>{page} из {pages}</span>{page < pages && <Link href={`${path}?reviewsPage=${page + 1}#reviews-heading`}>Следующие отзывы →</Link>}</nav>}
  </section>;
}
