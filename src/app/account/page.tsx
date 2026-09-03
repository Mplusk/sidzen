import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate, formatPrice } from "@/lib/format";

export const metadata: Metadata = { title: "Личный кабинет", robots: { index: false, follow: false } };

export default async function AccountPage() {
  const user = await requireUser();
  const [orders, orderCount, activeCount, deliveredCount] = await Promise.all([
    prisma.order.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.order.count({ where: { userId: user.id } }),
    prisma.order.count({ where: { userId: user.id, status: { notIn: ["DELIVERED", "CANCELED", "REFUNDED"] } } }),
    prisma.order.count({ where: { userId: user.id, status: "DELIVERED" } }),
  ]);
  return <><span className="eyebrow">Личный кабинет</span><h1>Здравствуйте, {user.name?.split(" ")[0] ?? "клиент"}</h1><div className="stats-grid"><div className="stat-card"><span>Всего заказов</span><strong>{orderCount}</strong></div><div className="stat-card"><span>Активные</span><strong>{activeCount}</strong></div><div className="stat-card"><span>Получено</span><strong>{deliveredCount}</strong></div></div><div className="section-heading" style={{ marginTop: 50 }}><h2 style={{ fontSize: "2rem" }}>Последние заказы</h2><Link className="text-link" href="/account/orders/">Все заказы</Link></div>{orders.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Заказ</th><th>Дата</th><th>Статус</th><th>Сумма</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td><Link href={`/account/orders/${order.number}/`}><strong>{order.number}</strong></Link></td><td>{formatDate(order.createdAt)}</td><td><span className="status">{orderStatus(order.status)}</span></td><td>{formatPrice(order.total)}</td></tr>)}</tbody></table></div> : <div className="empty-state"><h3>Первого заказа ещё нет</h3><p>Выберите изделие в каталоге и добавьте его в корзину.</p><Link className="button" href="/catalog/">Перейти в каталог</Link></div>}</>;
}

export function orderStatus(status: string) {
  return ({ NEW: "Новый", ESTIMATING: "На оценке", APPROVED: "Согласован", AWAITING_PAYMENT: "Ожидает оплаты", PAID: "Оплачен", QUEUED: "В очереди", PRINTING: "Печатается", POST_PROCESSING: "Постобработка", PACKED: "Упакован", SHIPPED: "Отправлен", DELIVERED: "Получен", CANCELED: "Отменён", REFUNDED: "Возврат" } as Record<string, string>)[status] ?? status;
}
