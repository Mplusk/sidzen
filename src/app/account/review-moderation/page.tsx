import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { reviewPage, reviewStatusLabel } from "@/lib/reviews";
import { ReviewCard } from "@/components/review-card";
import { moderateReviewAction } from "@/app/actions/reviews";
import { reviewAiReasons } from "@/lib/review-ai/policy";

export const metadata: Metadata = { title: "Проверка отзывов", robots: { index: false, follow: false } };
export default async function ReviewModeration({ searchParams }: { searchParams: Promise<{ status?: string; page?: string; saved?: string; error?: string }> }) {
  await requirePermission("content.write");
  const query = await searchParams, status = ["PENDING", "PUBLISHED", "HIDDEN", "ALL"].includes(query.status ?? "") ? query.status! : "PENDING";
  const where = status === "ALL" ? {} : { status };
  const total = await prisma.review.count({ where }), { page, pages } = reviewPage(query.page, total, 20);
  const rows = await prisma.review.findMany({ where, include: { aiJob: true, product: { select: { name: true } }, consent: { select: { revokedAt: true } }, images: { orderBy: { sortOrder: "asc" } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20, skip: (page - 1) * 20 });
  return <><h1>Проверка отзывов</h1><p className="muted">Проверяйте спам, чужие персональные данные и фото. Низкая оценка сама по себе не основание для скрытия. Текст и оценку покупателя менять нельзя.</p>
    {query.saved && <p className="notice notice--success" role="status">Решение сохранено.</p>}{query.error && <p className="notice notice--danger" role="alert">Отзыв удалён или согласие на публикацию отозвано.</p>}
    <form method="get" className="form-grid"><label className="field">Статус<select name="status" defaultValue={status}><option value="PENDING">На проверке</option><option value="PUBLISHED">Опубликованные</option><option value="HIDDEN">Не опубликованные</option><option value="ALL">Все</option></select></label><button className="button button--small">Показать</button></form>
    <p>Найдено: {total}.</p>{rows.map(row => <div className="own-review" key={row.id}><strong>{row.product.name}</strong><p className="muted">{reviewStatusLabel(row.status)}</p>{row.aiJob && <p className="notice">{reviewAiReasons[row.aiJob.status === "RUNNING" ? "processing" : row.aiJob.reason ?? "queued"] ?? "Требуется проверка администратором"}</p>}<ReviewCard review={row} /><form action={moderateReviewAction} className="review-moderation-actions"><input type="hidden" name="reviewId" value={row.id} /><button className="button button--small" name="decision" value="PUBLISHED" disabled={row.verifiedPurchase && (!row.consent || !!row.consent.revokedAt)}>Опубликовать</button><button className="button button--outline button--small" name="decision" value="HIDDEN">Не публиковать / скрыть</button></form></div>)}
    {!rows.length && <p className="muted">Нет отзывов с выбранным статусом.</p>}
    {pages > 1 && <nav className="pagination" aria-label="Проверка отзывов">{page > 1 && <Link href={`?status=${status}&page=${page - 1}`}>←</Link>}<span>{page} из {pages}</span>{page < pages && <Link href={`?status=${status}&page=${page + 1}`}>→</Link>}</nav>}
  </>;
}
