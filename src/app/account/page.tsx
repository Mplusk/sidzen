import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate, formatPrice } from "@/lib/format";
import { orderStatus } from "@/lib/order-status";
import { ContinuePayment } from "@/components/continue-payment";
import { canContinuePayment } from "@/lib/payment-availability";
import styles from "./account-overview.module.css";

export const metadata: Metadata = { title: "Личный кабинет", robots: { index: false, follow: false } };

export default async function AccountPage() {
  const user = await requireUser();
  const [orders, orderCount, activeCount, deliveredCount] = await Promise.all([
    prisma.order.findMany({ where: { userId: user.id, deletedAt: null }, include: { payment: true }, orderBy: { createdAt: "desc" }, take: 5 }),
    prisma.order.count({ where: { userId: user.id, deletedAt: null } }),
    prisma.order.count({ where: { userId: user.id, deletedAt: null, status: { notIn: ["DELIVERED", "CANCELED", "REFUNDED"] } } }),
    prisma.order.count({ where: { userId: user.id, deletedAt: null, status: "DELIVERED" } }),
  ]);
  const hasPaymentActions = orders.some(order => canContinuePayment(order));
  return <>
    <span className="eyebrow">Личный кабинет</span><h1>Здравствуйте, {user.name?.split(" ")[0] ?? "клиент"}</h1>
    <div className="stats-grid"><div className="stat-card"><span>Всего заказов</span><strong>{orderCount}</strong></div><div className="stat-card"><span>Активные</span><strong>{activeCount}</strong></div><div className="stat-card"><span>Получено</span><strong>{deliveredCount}</strong></div></div>
    <div className="section-heading" style={{ marginTop: 50 }}><h2 style={{ fontSize: "2rem" }}>Последние заказы</h2><Link className="text-link" href="/account/orders/">Все заказы</Link></div>
    {orders.length ? <div className="data-table-wrap"><table className={`data-table ${styles.table}`}>
      <thead><tr><th scope="col">Заказ</th><th scope="col">Дата</th><th scope="col">Статус</th><th scope="col">Сумма</th>{hasPaymentActions && <th scope="col">Оплата</th>}</tr></thead>
      <tbody>{orders.map(order => <tr key={order.id}>
        <td data-label="Заказ"><Link href={`/account/orders/${order.number}/`}><strong>{order.number}</strong></Link></td>
        <td data-label="Дата">{formatDate(order.createdAt)}</td>
        <td data-label="Статус"><span className="status">{orderStatus(order.status)}</span></td>
        <td data-label="Сумма">{formatPrice(order.total)}</td>
        {hasPaymentActions && <td className={styles.payment}><ContinuePayment order={order} compact /></td>}
      </tr>)}</tbody>
    </table></div> : <div className="empty-state"><h3>Первого заказа ещё нет</h3><p>Выберите изделие в каталоге и добавьте его в корзину.</p><Link className="button" href="/">Перейти в каталог</Link></div>}
  </>;
}
