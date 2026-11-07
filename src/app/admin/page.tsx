import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatPrice } from "@/lib/format";
import { fiscalAttentionWhere } from "@/lib/cloudkassir/attention";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { orderStatus } from "@/lib/order-status";
import { dashboardDelivery } from "@/lib/dashboard-delivery";
import { dashboardDeliveryCost } from "@/lib/dashboard-delivery-cost";
import { destinationCity } from "@/lib/delivery/destination-city";
import { receivedOrdersWhere } from "@/lib/dashboard-orders";
import styles from "./dashboard.module.css";

export const metadata: Metadata = { title: "Дашборд управления", robots: { index: false, follow: false } };
const pageSize = 25;
const dateTime = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
function DateValue({ date }: { date: Date | null }) { return date ? <time dateTime={date.toISOString()}>{dateTime.format(date)} МСК</time> : <>Нет данных</>; }

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<{ view?: string; page?: string }> }) {
  const user = await requirePermission(PERMISSIONS.dashboardView);
  const canReadOrders = user.roles.includes("superadmin") || user.permissions.has(PERMISSIONS.ordersRead);
  const params = await searchParams;
  const archived = params.view === "received";
  const requestedPage = Number(params.page);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 100000) : 1;
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
  const where: Prisma.OrderWhereInput = { deletedAt: null, ...(archived ? receivedOrdersWhere : { NOT: receivedOrdersWhere }) };
  const [orders, total, needsConfirmation] = canReadOrders ? await Promise.all([
    prisma.order.findMany({ where, include: { shipment: { include: { ozonJob: true, cdekJob: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.order.count({ where }),
    prisma.order.count({ where: { deletedAt: null, status: { notIn: ["DELIVERED", "CANCELED", "REFUNDED"] }, shipment: { is: { deliveredAt: { not: null } } }, AND: [receivedOrdersWhere] } }),
  ]) : [[], 0, 0];
  const base = archived ? "/admin/?view=received" : "/admin/?view=active";
  return <>
    <div className="admin-header"><div><span className="eyebrow">Управление</span><h1>Дашборд</h1></div><Link className="button" href="/admin/orders/">Заявки покупателей</Link></div>
    <p className="notice">Новых заявок: <strong>{estimating}</strong>. <Link className="text-link" href="/admin/orders/?status=NEW">Открыть и связаться с покупателями →</Link></p>
    {fiscalAttention > 0 && <p className="notice notice--danger" role="alert">Прежних заказов, требующих проверки чеков: {fiscalAttention}. <Link className="text-link" href="/admin/orders/?fiscal=attention">Открыть сверку CloudKassir →</Link></p>}
    <div className="admin-grid">
      <div className="admin-card admin-card--metric"><span>Заявки и заказы сегодня</span><strong>{ordersToday}</strong></div>
      <div className="admin-card admin-card--metric"><span>Прежние онлайн-продажи сегодня</span><strong>{formatPrice(Number(revenue._sum.total) || 0)}</strong></div>
      <div className="admin-card admin-card--metric"><span>Средний чек прежних онлайн-продаж</span><strong>{formatPrice(Number(average._avg.total) || 0)}</strong></div>
      <div className="admin-card admin-card--metric"><span>Новые заявки</span><strong>{estimating}</strong></div>
      {canReadOrders && <section className={`admin-card admin-card--wide ${styles.orders}`} aria-labelledby="dashboard-orders">
        <div className={styles.heading}><div><h2 id="dashboard-orders">{archived ? "Полученные заказы" : "Заявки и заказы"}</h2><p className="muted">{archived ? "Заказы с подтверждённым получением" : "Статусы заказов и доставки"} · {total}</p></div><nav className={styles.tabs} aria-label="Списки заказов"><Link className={`button button--small ${archived ? "button--outline" : ""}`} href="/admin/" aria-current={!archived ? "page" : undefined}>Текущие</Link><Link className={`button button--small ${!archived ? "button--outline" : ""}`} href="/admin/?view=received" aria-current={archived ? "page" : undefined}>Архив полученных</Link></nav></div>
        {needsConfirmation > 0 && <p className="notice" role="status">Получение подтверждено службой доставки для {needsConfirmation} заказов. Откройте <Link className="text-link" href="/admin/?view=received">архив</Link> и подтвердите получение в карточке заказа для завершения обработки и расчётов.</p>}
        {orders.length ? <div className="data-table-wrap"><table className={`data-table ${styles.table}`} role="table"><thead><tr><th scope="col">Заказ</th><th scope="col">Создан</th><th scope="col">Статус заказа</th><th scope="col">Доставка</th><th scope="col">Стоимость доставки</th><th scope="col">{archived ? "Получение" : "Сумма"}</th></tr></thead><tbody>{orders.map(order => {
          const delivery = dashboardDelivery(order.shipment);
          const cost = dashboardDeliveryCost(order.shipment?.cost, order.subtotal);
          const city = destinationCity(order.shippingAddress, order.shipment?.provider);
          const received = order.shipment?.deliveredAt ?? (order.status === "DELIVERED" ? order.purchaseConfirmedAt ?? order.statusChangedAt : null);
          return <tr key={order.id} role="row"><td data-label="Заказ"><Link className="text-link" href={`/admin/orders/${encodeURIComponent(order.number)}/`}><strong>{order.number}</strong></Link><span className={styles.detail}>{order.kind === "APPLICATION" ? "Заявка" : "Заказ"} · {order.customerName}</span></td><td data-label="Создан"><DateValue date={order.createdAt} /></td><td data-label="Статус заказа"><span className="status">{orderStatus(order.status)}</span><span className={styles.detail}>Изменён: <DateValue date={order.statusChangedAt} /></span>{!archived && order.status === "DELIVERED" && <span className={styles.attention}>Проверьте статус доставки</span>}</td><td data-label="Доставка"><span>{delivery.label}</span><span className={styles.detail}>Город: {city ?? "не определён"}</span><span className={styles.detail}>Изменён: <DateValue date={delivery.changedAt} /></span></td><td data-label="Стоимость доставки">{cost ? <><span>{formatPrice(cost.amount)}</span><span className={styles.detail}>{cost.share ? `${cost.share} от стоимости товаров` : "Доля от товаров не рассчитана"}</span></> : "Нет данных"}</td><td data-label={archived ? "Получение" : "Сумма"}>{archived ? <><DateValue date={received} /><span className={styles.detail}>{order.shipment?.deliveredAt ? "По данным службы доставки" : "Дата подтверждения получения"}</span>{order.status !== "DELIVERED" && <span className={styles.attention}>Требует подтверждения</span>}</> : formatPrice(order.total)}</td></tr>;
        })}</tbody></table></div> : <p className={styles.empty}>{page > 1 ? "На этой странице заказов нет." : archived ? "Полученных заказов пока нет." : "Текущих заявок и заказов пока нет."}</p>}
        {(page > 1 || page * pageSize < total) && <div className={styles.pagination}>{page > 1 && <Link className="button button--outline button--small" href={`${base}&page=${page - 1}`}>← Назад</Link>}<span>Страница {page}</span>{page * pageSize < total && <Link className="button button--outline button--small" href={`${base}&page=${page + 1}`}>Далее →</Link>}</div>}
        <p className={styles.footnote}>Указана сохранённая предварительная стоимость перевозчика; процент рассчитан от стоимости товаров без доставки. Время указано по Москве. Для прошлых заказов даты, которые нельзя достоверно восстановить, не отображаются.</p>
      </section>}
      <div className="admin-card"><h2>В работе</h2><p><strong style={{ fontSize: "2.5rem" }}>{printing}</strong><br />заявок и заказов в работе</p><Link className="text-link" href="/admin/orders/?status=production">Открыть заказы</Link></div>
      <div className="admin-card"><h2>SEO-здоровье</h2><p>Товаров без полного описания или description: <strong>{thinContent}</strong></p><p>Неактивных редиректов: <strong>{brokenRedirects}</strong></p><Link className="text-link" href="/admin/seo/">Открыть SEO-модуль</Link></div>
    </div>
  </>;
}
