import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate, formatPrice } from "@/lib/format";
import { orderStatus } from "@/lib/order-status";
import { dashboardDelivery } from "@/lib/dashboard-delivery";
import { estimatedDelivery } from "@/lib/delivery/estimated-date";
import { DeliveryEstimate } from "@/components/delivery-estimate";
import { ContinuePayment } from "@/components/continue-payment";
import styles from "./orders.module.css";

export const metadata: Metadata = { title: "Мои заказы", robots: { index: false, follow: false } };

export default async function OrdersPage() {
  const user = await requireUser();
  const orders = await prisma.order.findMany({ where: { userId: user.id, deletedAt: null }, include: { items: true, payment: true, shipment: { include: { ozonJob: { select: { status: true, request: true, response: true, cancelRequestedAt: true } }, cdekJob: { select: { status: true, deliveryStatus: true, deliveryStatusChangedAt: true, cancelRequestedAt: true } } } } }, orderBy: { createdAt: "desc" } });
  return <><span className="eyebrow">История</span><h1>Мои заказы</h1>{orders.length ? <div className="data-table-wrap"><table className={`data-table ${styles.table}`} role="table"><thead><tr><th scope="col">Номер</th><th scope="col">Дата</th><th scope="col">Позиций</th><th scope="col">Статус</th><th scope="col">Доставка</th><th scope="col">Трек</th><th scope="col">Сумма</th></tr></thead><tbody>{orders.map(order => <tr key={order.id} role="row"><td data-label="Номер"><Link href={`/account/orders/${order.number}/`}><strong>{order.number}</strong></Link></td><td data-label="Дата">{formatDate(order.createdAt)}</td><td data-label="Позиций">{order.items.length}</td><td data-label="Статус"><span className="status">{orderStatus(order.status)}</span><ContinuePayment order={order} /></td><td data-label="Доставка">{dashboardDelivery(order.shipment).label}<DeliveryEstimate estimate={estimatedDelivery(order.shipment, order.status)} /></td><td data-label="Трек">{order.shipment?.tracking ?? "—"}</td><td data-label="Сумма">{formatPrice(order.total)}</td></tr>)}</tbody></table></div> : <div className="empty-state">Заказов пока нет.</div>}</>;
}
