import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDate, formatPrice } from "@/lib/format";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { AdminDeleteOrder } from "@/components/admin-delete-order";

export const metadata: Metadata = { title: "Заказы — управление", robots: { index: false, follow: false } };

export default async function AdminOrdersPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; deleted?: string; error?: string }> }) {
  const params = await searchParams;
  const deletionError = params.error === "payment-active" ? "У заказа есть незавершённый платёж. Сначала сверьте его с банком; дождитесь оплаты или истечения платёжной ссылки. Удаление не отменяет оплату в банке." : params.error === "delivery-active" ? "Сначала отмените или завершите доставку Ozon в карточке заказа. Неоднозначные отправления требуют сверки в Ozon." : params.error === "confirmation" ? "Удаление не подтверждено. Откройте окно удаления и подтвердите действие." : params.error === "missing" ? "Заказ уже удалён или не найден." : "Не удалось удалить заказ. Попробуйте ещё раз.";
  const user = await requirePermission(PERMISSIONS.ordersRead);
  const canDelete = user?.roles.includes("superadmin") || user?.permissions.has(PERMISSIONS.ordersWrite);
  const statuses = params.status === "production" ? ["QUEUED", "PRINTING", "POST_PROCESSING"] : params.status ? [params.status] : undefined;
  const orders = await prisma.order.findMany({ where: { ...(statuses ? { status: { in: statuses as never[] } } : {}), ...(params.q ? { OR: [{ number: { contains: params.q, mode: "insensitive" } }, { customerEmail: { contains: params.q, mode: "insensitive" } }, { customerPhone: { contains: params.q } }] } : {}) }, include: { items: true, payment: true, shipment: true }, orderBy: { createdAt: "desc" }, take: 200 });
  return <><div className="admin-header"><div><span className="eyebrow">Производство</span><h1>Заказы</h1></div><form><input name="q" defaultValue={params.q} placeholder="Номер, email, телефон" /><button className="button button--small">Найти</button></form></div>{params.deleted && <p className="notice notice--success" role="status">Заказ {params.deleted} удалён.</p>}{params.error && <p className="notice notice--danger" role="alert">{deletionError}</p>}<div className="data-table-wrap"><table className="data-table"><thead><tr><th>Номер</th><th>Дата</th><th>Клиент</th><th>Позиций</th><th>Статус</th><th>Оплата</th><th>Сумма</th>{canDelete && <th>Действия</th>}</tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td><Link href={`/admin/orders/${order.number}/`}><strong>{order.number}</strong></Link></td><td>{formatDate(order.createdAt)}</td><td>{order.customerName}<br /><small>{order.customerPhone}</small></td><td>{order.items.length}</td><td><span className="status">{order.status}</span></td><td>{order.payment?.status ?? "—"}</td><td>{formatPrice(order.total)}</td>{canDelete && <td><AdminDeleteOrder id={order.id} number={order.number} /></td>}</tr>)}</tbody></table></div>{!orders.length && <p className="catalog-empty">Заказов пока нет.</p>}</>;
}
