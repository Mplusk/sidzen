import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { purchasedProductWhere, reviewPage, reviewStatusLabel } from "@/lib/reviews";
import { ReviewCard } from "@/components/review-card";
import { ReviewForm } from "@/components/review-form";
import { DeleteOwnReview } from "@/components/delete-own-review";
import { operatorReady } from "@/lib/privacy";

export const metadata: Metadata = { title: "Мои отзывы", robots: { index: false, follow: false } };
const errors: Record<string, string> = { invalid: "Укажите имя или псевдоним (2–40 символов), оценку от 1 до 5, отзыв (10–3000 символов) и согласие на публикацию.", purchase: "Отзыв доступен только для оплаченного и полученного товара из вашего аккаунта.", duplicate: "Вы уже оставили отзыв об этом товаре.", images: "Фото не загружены. Допустимы до 5 файлов JPG, PNG или WebP, по 5 МБ, без анимации. Файл должен быть настоящей фотографией.", privacy: "Приём отзывов временно недоступен: магазин ещё не настроил обработку данных.", rate: "Слишком много попыток. Повторите через час.", save: "Не удалось сохранить отзыв. Попробуйте ещё раз.", confirmation: "Подтвердите удаление отзыва.", missing: "Отзыв не найден в вашем аккаунте." };
export default async function MyReviews({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string; deleted?: string; page?: string; purchasesPage?: string }> }) {
  const user = await requireUser("/account/reviews/"), query = await searchParams;
  const total = await prisma.review.count({ where: { userId: user.id } }), { page, pages } = reviewPage(query.page, total);
  const purchasedWhere = { orderItems: { some: { quantity: { gt: 0 }, order: purchasedProductWhere(user.id) } }, reviews: { none: { userId: user.id } } };
  const purchaseTotal = await prisma.product.count({ where: purchasedWhere }), purchasePages = reviewPage(query.purchasesPage, purchaseTotal);
  const [rows, purchased, ready] = await Promise.all([
    prisma.review.findMany({ where: { userId: user.id }, include: { product: { select: { name: true } }, images: { orderBy: { sortOrder: "asc" } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * 10, take: 10 }),
    prisma.product.findMany({ where: purchasedWhere, select: { id: true, name: true }, orderBy: { name: "asc" }, skip: (purchasePages.page - 1) * 10, take: 10 }),
    operatorReady(),
  ]);
  return <><h1>Мои отзывы</h1><p className="muted">Отзывы только о товарах, которые вы оплатили и получили. Один отзыв на товар. Витрина показывает отзывы после проверки, независимо от оценки.</p>
    {query.error && <p className="notice notice--danger" role="alert">{errors[query.error] ?? errors.save}</p>}
    {query.sent && <p className="notice notice--success" role="status">Отзыв и фотографии сохранены. После проверки они появятся в карточке товара.</p>}
    {query.deleted && <p className="notice notice--success" role="status">Отзыв и фотографии удалены. Согласие на публикацию отозвано.</p>}
    <h2>Поделитесь впечатлениями</h2>{!ready && <p className="notice">{errors.privacy}</p>}
    {purchased.map(product => <details className="review-compose" key={product.id}><summary>{product.name} — написать отзыв</summary>{ready && <ReviewForm productId={product.id} />}</details>)}
    {!purchaseTotal && <p className="muted">Нет товаров, для которых можно написать новый отзыв. Проверьте статус в <Link className="text-link" href="/account/orders/">заказах</Link>.</p>}
    {purchasePages.pages > 1 && <nav className="pagination" aria-label="Товары для отзыва">{purchasePages.page > 1 && <Link href={`?page=${page}&purchasesPage=${purchasePages.page - 1}`}>← Предыдущие товары</Link>}<span>{purchasePages.page} из {purchasePages.pages}</span>{purchasePages.page < purchasePages.pages && <Link href={`?page=${page}&purchasesPage=${purchasePages.page + 1}`}>Следующие товары →</Link>}</nav>}
    <h2>Ваши отзывы</h2>{rows.map(row => <div className="own-review" key={row.id}><strong>{row.product.name}</strong><p className="muted">{reviewStatusLabel(row.status)}</p><ReviewCard review={row} /><DeleteOwnReview id={row.id} /></div>)}{!rows.length && <p className="muted">Вы ещё не оставляли отзывов.</p>}
    {pages > 1 && <nav className="pagination" aria-label="Мои отзывы">{page > 1 && <Link href={`?page=${page - 1}&purchasesPage=${purchasePages.page}`}>←</Link>}<span>{page} из {pages}</span>{page < pages && <Link href={`?page=${page + 1}&purchasesPage=${purchasePages.page}`}>→</Link>}</nav>}
  </>;
}
