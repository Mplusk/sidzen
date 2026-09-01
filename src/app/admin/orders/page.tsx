import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDate, formatPrice } from "@/lib/format";

export const metadata: Metadata = { title: "Заказы — управление", robots: { index: false, follow: false } };

export default async function AdminOrdersPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const params = await searchParams;
  const statuses = params.status === "production" ? ["QUEUED", "PRINTING", "POST_PROCESSING"] : params.status ? [params.status] : undefined;
  const orders = await prisma.order.findMany({ where: { ...(statuses ? { status: { in: statuses as never[] } } : {}), ...(params.q ? { OR: [{ number: { contains: params.q, mode: "insensitive" } }, { customerEmail: { contains: params.q, mode: "insensitive" } }, { customerPhone: { contains: params.q } }] } : {}) }, include: { items: true, payment: true, shipment: true }, orderBy: { createdAt: "desc" }, take: 200 });
  return <><div className="admin-header"><div><span className="eyebrow">Производство</span><h1>Заказы</h1></div><form><input name="q" defaultValue={params.q} placeholder="Номер, email, телефон" /><button className="button button--small">Найти</button></form></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Номер</th><th>Дата</th><th>Клиент</th><th>Позиций</th><th>Статус</th><th>Оплата</th><th>Сумма</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td><Link href={`/admin/orders/${order.number}/`}><strong>{order.number}</strong></Link></td><td>{formatDate(order.createdAt)}</td><td>{order.customerName}<br /><small>{order.customerPhone}</small></td><td>{order.items.length}</td><td><span className="status">{order.status}</span></td><td>{order.payment?.status ?? "—"}</td><td>{formatPrice(order.total)}</td></tr>)}</tbody></table></div></>;
}
