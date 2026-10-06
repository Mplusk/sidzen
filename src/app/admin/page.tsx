import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatPrice } from "@/lib/format";
import { fiscalAttentionWhere } from "@/lib/cloudkassir/attention";

export const metadata: Metadata = { title: "Дашборд управления", robots: { index: false, follow: false } };

export default async function AdminDashboard() {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const [ordersToday, revenue, average, estimating, printing, thinContent, brokenRedirects, fiscalAttention] = await Promise.all([
    prisma.order.count({ where: { deletedAt: null, createdAt: { gte: start } } }),
    prisma.order.aggregate({ where: { kind: "ORDER", createdAt: { gte: start }, status: { notIn: ["CANCELED", "REFUNDED"] }, payment: { is: { status: "PAID" } } }, _sum: { total: true } }),
    prisma.order.aggregate({ where: { kind: "ORDER", status: { notIn: ["CANCELED", "REFUNDED"] }, payment: { is: { status: "PAID" } } }, _avg: { total: true } }),
    prisma.order.count({ where: { deletedAt: null, kind: "APPLICATION", status: "NEW" } }),
    prisma.order.count({ where: { deletedAt: null, status: { in: ["IN_PROGRESS", "QUEUED", "PRINTING", "POST_PROCESSING"] } } }),
    prisma.product.count({ where: { status: "PUBLISHED", OR: [{ description: null }, { metaDescription: null }] } }),
    prisma.redirect.count({ where: { active: false } }),
    prisma.order.count({ where: fiscalAttentionWhere() }),
  ]);
  return <><div className="admin-header"><div><span className="eyebrow">Управление</span><h1>Дашборд</h1></div><Link className="button" href="/admin/orders/">Заявки покупателей</Link></div><p className="notice">Новых заявок: <strong>{estimating}</strong>. <Link className="text-link" href="/admin/orders/?status=NEW">Открыть и связаться с покупателями →</Link></p>{fiscalAttention > 0 && <p className="notice notice--danger" role="alert">Прежних заказов, требующих проверки чеков: {fiscalAttention}. <Link className="text-link" href="/admin/orders/?fiscal=attention">Открыть сверку CloudKassir →</Link></p>}<div className="admin-grid"><div className="admin-card admin-card--metric"><span>Заявки и заказы сегодня</span><strong>{ordersToday}</strong></div><div className="admin-card admin-card--metric"><span>Прежние онлайн-продажи сегодня</span><strong>{formatPrice(Number(revenue._sum.total) || 0)}</strong></div><div className="admin-card admin-card--metric"><span>Средний чек прежних онлайн-продаж</span><strong>{formatPrice(Number(average._avg.total) || 0)}</strong></div><div className="admin-card admin-card--metric"><span>Новые заявки</span><strong>{estimating}</strong></div><div className="admin-card"><h2>В работе</h2><p><strong style={{ fontSize: "2.5rem" }}>{printing}</strong><br />заявок и заказов в работе</p><Link className="text-link" href="/admin/orders/?status=production">Открыть заказы</Link></div><div className="admin-card"><h2>SEO-здоровье</h2><p>Товаров без полного описания или description: <strong>{thinContent}</strong></p><p>Неактивных редиректов: <strong>{brokenRedirects}</strong></p><Link className="text-link" href="/admin/seo/">Открыть SEO-модуль</Link></div></div></>;
}
