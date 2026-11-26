import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { dashboardPageSize, loadAdminDashboard } from "@/lib/admin-dashboard";
import { formatPrice } from "@/lib/format";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { orderStatus } from "@/lib/order-status";
import { dashboardDelivery } from "@/lib/dashboard-delivery";
import { dashboardDeliveryCost } from "@/lib/dashboard-delivery-cost";
import { destinationCity } from "@/lib/delivery/destination-city";
import styles from "./dashboard.module.css";

export const metadata: Metadata = { title: "Дашборд управления", robots: { index: false, follow: false } };
const dateTime = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
function DateValue({ date }: { date: Date | null }) { return date ? <time dateTime={date.toISOString()}>{dateTime.format(date)} МСК</time> : <>Нет данных</>; }

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<{ view?: string; page?: string }> }) {
  const user = await requirePermission(PERMISSIONS.dashboardView);
  const canReadOrders = user.roles.includes("superadmin") || user.permissions.has(PERMISSIONS.ordersRead);
  const params = await searchParams;
  const archived = params.view === "received";
  const requestedPage = Number(params.page);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 100000) : 1;
  return <>
    <div className="admin-header"><div><span className="eyebrow">Управление</span><h1>Дашборд</h1></div><Link className="button" href="/admin/orders/">Заявки покупателей</Link></div>
    <Suspense fallback={<p className="admin-card" role="status">Загружаем данные кабинета…</p>}>
      <DashboardContent archived={archived} page={page} canReadOrders={canReadOrders} />
    </Suspense>
  </>;
}

async function DashboardContent(options: Parameters<typeof loadAdminDashboard>[0]) {
  const { archived, page, canReadOrders } = options;
  const { ordersToday, revenue, average, newApplications, inProduction, thinContent, brokenRedirects, fiscalAttention, orders, total, needsConfirmation, lateStock } = await loadAdminDashboard(options);
  const base = archived ? "/admin/?view=received" : "/admin/?view=active";
  return <>
    <p className="notice">Новых заявок: <strong>{newApplications}</strong>. <Link className="text-link" href="/admin/orders/?status=NEW">Открыть и связаться с покупателями →</Link></p>
    {fiscalAttention > 0 && <p className="notice notice--danger" role="alert">Прежних заказов, требующих проверки чеков: {fiscalAttention}. <Link className="text-link" href="/admin/orders/?fiscal=attention">Открыть сверку CloudKassir →</Link></p>}
    {lateStock && <p className="notice notice--danger" role="alert">Оплата поступила после окончания резерва, а товар недоступен. <Link className="text-link" href={`/admin/orders/${encodeURIComponent(lateStock.number)}/`}>Проверить заказ {lateStock.number} →</Link></p>}
    <div className="admin-grid">
      <div className="admin-card admin-card--metric"><span>Заявки и заказы сегодня</span><strong>{ordersToday}</strong></div>
      <div className="admin-card admin-card--metric"><span>Прежние онлайн-продажи сегодня</span><strong>{formatPrice(revenue ?? 0)}</strong></div>
      <div className="admin-card admin-card--metric"><span>Средний чек прежних онлайн-продаж</span><strong>{formatPrice(average ?? 0)}</strong></div>
      <div className="admin-card admin-card--metric"><span>Новые заявки</span><strong>{newApplications}</strong></div>
      {canReadOrders && <section className={`admin-card admin-card--wide ${styles.orders}`} aria-labelledby="dashboard-orders">
        <div className={styles.heading}><div><h2 id="dashboard-orders">{archived ? "Архив заказов" : "Заявки и заказы"}</h2><p className="muted">{archived ? "Полученные и отменённые заказы" : "Статусы заказов и доставки"} · {total}</p></div><nav className={styles.tabs} aria-label="Списки заказов"><Link className={`button button--small ${archived ? "button--outline" : ""}`} href="/admin/" aria-current={!archived ? "page" : undefined}>Текущие</Link><Link className={`button button--small ${!archived ? "button--outline" : ""}`} href="/admin/?view=received" aria-current={archived ? "page" : undefined}>Архив</Link></nav></div>
        {needsConfirmation > 0 && <p className="notice" role="status">Получение подтверждено службой доставки для {needsConfirmation} заказов. Откройте <Link className="text-link" href="/admin/?view=received">архив</Link> и подтвердите получение в карточке заказа для завершения обработки и расчётов.</p>}
        {orders.length ? <div className="data-table-wrap"><table className={`data-table ${styles.table}`} role="table"><thead><tr><th scope="col">Заказ</th><th scope="col">Создан</th><th scope="col">Статус заказа</th><th scope="col">Доставка</th><th scope="col">Стоимость доставки</th><th scope="col">{archived ? "Получение / отмена" : "Сумма"}</th></tr></thead><tbody>{orders.map(order => {
          const delivery = dashboardDelivery(order.shipment);
          const cost = dashboardDeliveryCost(order.shipment?.cost, order.subtotal);
          const city = destinationCity(order.shippingAddress, order.shipment?.provider);
          const received = order.shipment?.deliveredAt ?? (order.status === "DELIVERED" ? order.purchaseConfirmedAt ?? order.statusChangedAt : null);
          const canceled = order.status === "CANCELED";
          const cancellationUnconfirmed = canceled && ((order.shipment?.ozonJob && order.shipment.ozonJob.status !== "CANCELED") || (order.shipment?.cdekJob && order.shipment.cdekJob.status !== "CANCELED"));
          return <tr key={order.id} role="row"><td data-label="Заказ"><Link className="text-link" href={`/admin/orders/${encodeURIComponent(order.number)}/`}><strong>{order.number}</strong></Link><span className={styles.detail}>{order.kind === "APPLICATION" ? "Заявка" : "Заказ"} · {order.customerName}</span></td><td data-label="Создан"><DateValue date={order.createdAt} /></td><td data-label="Статус заказа"><span className="status" data-order-status={order.status}>{orderStatus(order.status)}</span><span className={styles.detail}>Изменён: <DateValue date={order.statusChangedAt} /></span>{!archived && order.status === "DELIVERED" && <span className={styles.attention}>Проверьте статус доставки</span>}</td><td data-label="Доставка"><span>{delivery.label}</span><span className={styles.detail}>Город: {city ?? "не определён"}</span><span className={styles.detail}>Изменён: <DateValue date={delivery.changedAt} /></span>{cancellationUnconfirmed && <span className={styles.attention}>Проверьте отмену доставки</span>}</td><td data-label="Стоимость доставки">{cost ? <><span>{formatPrice(cost.amount)}</span><span className={styles.detail}>{cost.share ? `${cost.share} от стоимости товаров` : "Доля от товаров не рассчитана"}</span></> : "Нет данных"}</td><td data-label={archived ? "Получение / отмена" : "Сумма"}>{archived ? canceled ? <><DateValue date={order.statusChangedAt} /><span className={styles.detail}>Дата отмены заказа</span></> : <><DateValue date={received} /><span className={styles.detail}>{order.shipment?.deliveredAt ? "По данным службы доставки" : "Дата подтверждения получения"}</span>{order.status !== "DELIVERED" && <span className={styles.attention}>Требует подтверждения</span>}</> : formatPrice(order.total)}</td></tr>;
        })}</tbody></table></div> : <p className={styles.empty}>{page > 1 ? "На этой странице заказов нет." : archived ? "Полученных и отменённых заказов пока нет." : "Текущих заявок и заказов пока нет."}</p>}
        {(page > 1 || page * dashboardPageSize < total) && <div className={styles.pagination}>{page > 1 && <Link className="button button--outline button--small" href={`${base}&page=${page - 1}`}>← Назад</Link>}<span>Страница {page}</span>{page * dashboardPageSize < total && <Link className="button button--outline button--small" href={`${base}&page=${page + 1}`}>Далее →</Link>}</div>}
        <p className={styles.footnote}>Указана сохранённая предварительная стоимость перевозчика; процент рассчитан от стоимости товаров без доставки. Время указано по Москве. Для прошлых заказов даты, которые нельзя достоверно восстановить, не отображаются.</p>
      </section>}
      <div className="admin-card"><h2>В работе</h2><p><strong style={{ fontSize: "2.5rem" }}>{inProduction}</strong><br />заявок и заказов в работе</p><Link className="text-link" href="/admin/orders/?status=production">Открыть заказы</Link></div>
      <div className="admin-card"><h2>SEO-здоровье</h2><p>Товаров без полного описания или description: <strong>{thinContent}</strong></p><p>Неактивных редиректов: <strong>{brokenRedirects}</strong></p><Link className="text-link" href="/admin/seo/">Открыть SEO-модуль</Link></div>
    </div>
  </>;
}
