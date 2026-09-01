import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatPrice } from "@/lib/format";

export const metadata: Metadata = { title: "Дашборд управления", robots: { index: false, follow: false } };

export default async function AdminDashboard() {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const [ordersToday, revenue, average, estimating, printing, thinContent, brokenRedirects] = await Promise.all([
    prisma.order.count({ where: { createdAt: { gte: start } } }),
    prisma.order.aggregate({ where: { createdAt: { gte: start }, status: { notIn: ["CANCELED", "REFUNDED"] } }, _sum: { total: true } }),
    prisma.order.aggregate({ where: { status: { notIn: ["CANCELED", "REFUNDED"] } }, _avg: { total: true } }),
    prisma.order.count({ where: { status: "ESTIMATING" } }),
    prisma.order.count({ where: { status: { in: ["QUEUED", "PRINTING", "POST_PROCESSING"] } } }),
    prisma.product.count({ where: { status: "PUBLISHED", OR: [{ description: null }, { metaDescription: null }] } }),
    prisma.redirect.count({ where: { active: false } }),
  ]);
  return <><div className="admin-header"><div><span className="eyebrow">Управление</span><h1>Дашборд</h1></div><Link className="button" href="/admin/products/">Добавить товар</Link></div><div className="admin-grid"><div className="admin-card admin-card--metric"><span>Заказы сегодня</span><strong>{ordersToday}</strong></div><div className="admin-card admin-card--metric"><span>Выручка сегодня</span><strong>{formatPrice(Number(revenue._sum.total) || 0)}</strong></div><div className="admin-card admin-card--metric"><span>Средний чек</span><strong>{formatPrice(Number(average._avg.total) || 0)}</strong></div><div className="admin-card admin-card--metric"><span>На оценке</span><strong>{estimating}</strong></div><div className="admin-card"><h2>Производство</h2><p><strong style={{ fontSize: "2.5rem" }}>{printing}</strong><br />заказов в очереди, печати или постобработке</p><Link className="text-link" href="/admin/orders/?status=production">Открыть заказы</Link></div><div className="admin-card"><h2>SEO-здоровье</h2><p>Товаров без полного описания или description: <strong>{thinContent}</strong></p><p>Неактивных редиректов: <strong>{brokenRedirects}</strong></p><Link className="text-link" href="/admin/seo/">Открыть SEO-модуль</Link></div></div></>;
}
