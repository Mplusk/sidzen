import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate, formatPrice } from "@/lib/format";
import { orderStatus } from "@/lib/order-status";

export const metadata: Metadata = { title: "Мои заказы", robots: { index: false, follow: false } };

export default async function OrdersPage() {
  const user = await requireUser();
  const orders = await prisma.order.findMany({ where: { userId: user.id, deletedAt: null }, include: { items: true, shipment: true }, orderBy: { createdAt: "desc" } });
  return <><span className="eyebrow">История</span><h1>Мои заказы</h1>{orders.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Номер</th><th>Дата</th><th>Позиций</th><th>Статус</th><th>Трек</th><th>Сумма</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td><Link href={`/account/orders/${order.number}/`}><strong>{order.number}</strong></Link></td><td>{formatDate(order.createdAt)}</td><td>{order.items.length}</td><td><span className="status">{orderStatus(order.status)}</span></td><td>{order.shipment?.tracking ?? "—"}</td><td>{formatPrice(order.total)}</td></tr>)}</tbody></table></div> : <div className="empty-state">Заказов пока нет.</div>}</>;
}
