import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDate, formatPrice } from "@/lib/format";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { fiscalAttentionWhere } from "@/lib/cloudkassir/attention";
import { AdminDeleteOrder } from "@/components/admin-delete-order";
import { applicationStatuses, orderStatuses, orderStatus } from "@/lib/order-status";

export const metadata: Metadata = { title: "Заявки и заказы — управление", robots: { index: false, follow: false } };

export default async function AdminOrdersPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; deleted?: string; error?: string; fiscal?: string; view?: string }> }) {
  const params = await searchParams;
  const deletionError = params.error === "fiscal-status" ? "Статус не изменён. Оплата / возврат старого заказа должны быть подтверждены банком. Для получения подтвердите фактическую передачу товара покупателю." : params.error === "application-status" ? "Выберите статус заявки. Для «Получен / выполнен» отдельно подтвердите состоявшуюся покупку и получение товара." : params.error === "confirmation" ? "Удаление не подтверждено. Откройте окно удаления и подтвердите действие." : params.error === "missing" ? "Заказ уже удалён или не найден." : "Не удалось выполнить действие. Проверьте данные и повторите.";
  const user = await requirePermission(PERMISSIONS.ordersRead);
  const canDelete = user?.roles.includes("superadmin") || user?.permissions.has(PERMISSIONS.ordersWrite);
  const archived = params.view === "deleted";
  const selected = orderStatuses.find(status => status === params.status);
  const statuses = params.status === "production" ? ["IN_PROGRESS", "QUEUED", "PRINTING", "POST_PROCESSING"] as const : selected ? [selected] : undefined;
  const [orders, incoming] = await Promise.all([
    prisma.order.findMany({ where: { ...(params.fiscal === "attention" ? { AND: [fiscalAttentionWhere()] } : { deletedAt: archived ? { not: null } : null }), ...(statuses ? { status: { in: [...statuses] } } : {}), ...(params.q ? { OR: [{ number: { contains: params.q.slice(0, 120), mode: "insensitive" } }, { customerName: { contains: params.q.slice(0, 120), mode: "insensitive" } }, { customerEmail: { contains: params.q.slice(0, 120), mode: "insensitive" } }, { customerPhone: { contains: params.q.slice(0, 120) } }] } : {}) }, include: { items: true, shipment: { include: { ozonJob: true } } }, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.order.count({ where: { kind: "APPLICATION", deletedAt: null, status: "NEW" } }),
  ]);
  return <>
    <div className="admin-header"><div><span className="eyebrow">Обработка обращений</span><h1>{archived ? "Удалённые" : "Заявки и заказы"}</h1></div></div>
    <p className="muted">Новые заявки поступают сюда без оплаты. При выборе Ozon отправление создаётся автоматически. Свяжитесь с покупателем и задайте статус.</p>
    <div className="confirm-dialog__actions"><Link className="button button--outline button--small" href="/admin/orders/">Все</Link><Link className="button button--outline button--small" href="/admin/orders/?status=NEW">Новые · {incoming}</Link><Link className="button button--outline button--small" href="/admin/orders/?status=IN_PROGRESS">В работе</Link><Link className="button button--outline button--small" href="/admin/orders/?view=deleted">Удалённые</Link></div>
    <form className="form-grid" style={{ margin: "18px 0" }}><label className="field">Поиск<input name="q" defaultValue={params.q} placeholder="Номер, имя, email, телефон" maxLength={120} /></label><label className="field">Статус<select name="status" defaultValue={params.status === "production" ? "production" : selected ?? ""}><option value="">Все статусы</option>{applicationStatuses.map(status => <option key={status} value={status}>{orderStatus(status)}</option>)}<option value="production">Все в производстве</option></select></label>{archived && <input type="hidden" name="view" value="deleted" />}<button className="button button--small">Показать</button></form>
    {params.deleted && <p className="notice notice--success" role="status">Заказ {params.deleted} удалён из рабочего списка. История сохранена в «Удалённых».</p>}{params.error && <p className="notice notice--danger" role="alert">{deletionError}</p>}
    {archived && <p className="notice">Для удалённых заявок автоматически запрашивается отмена Ozon. Откройте карточку, чтобы проверить подтверждение или ошибку отмены. Платежи не возвращаются этим действием; документы и история сохранены.</p>}
    <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Номер</th><th>Дата</th><th>Клиент</th><th>Позиций</th><th>Статус</th><th>Стоимость товаров</th>{canDelete && !archived && <th>Действия</th>}</tr></thead><tbody>{orders.map(order => <tr key={order.id}><td><Link href={`/admin/orders/${order.number}/`}><strong>{order.number}</strong></Link><br /><small>{order.deletedAt ? "Удалён · история сохранена" : order.kind === "APPLICATION" ? "Заявка" : "Ранее созданный заказ"}</small></td><td>{formatDate(order.createdAt)}</td><td>{order.customerName}<br /><a href={`tel:${order.customerPhone}`}>{order.customerPhone}</a><br /><a href={`mailto:${order.customerEmail}`}>{order.customerEmail}</a></td><td>{order.items.length}</td><td><span className="status">{orderStatus(order.status)}</span>{order.shipment?.ozonJob?.cancelRequestedAt && <p className={order.shipment.ozonJob.cancelError ? "notice notice--danger" : "muted"}>{order.shipment.ozonJob.status === "CANCELED" ? "Ozon: отменено" : order.shipment.ozonJob.cancelError ? "Ozon: отмена не подтверждена — откройте карточку" : "Ozon: ожидается отмена"}</p>}</td><td>{formatPrice(order.total)}</td>{canDelete && !archived && <td><Link className="text-link" href={`/admin/orders/${order.number}/`}>Открыть / статус</Link>{!order.deletedAt && <><br /><AdminDeleteOrder id={order.id} number={order.number} /></>}</td>}</tr>)}</tbody></table></div>
    {!orders.length && <p className="catalog-empty">{archived ? "Удалённых заказов пока нет." : "Заявки и заказы не найдены."}</p>}
  </>;
}
