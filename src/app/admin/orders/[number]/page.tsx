import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { updateOrderStatusAction, updateTrackingAction } from "@/app/actions/admin";
import { prisma } from "@/lib/prisma";
import { formatDate, formatPrice } from "@/lib/format";
import { getCurrentUser } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { AdminDeleteOrder } from "@/components/admin-delete-order";
import { OzonShipmentPanel } from "@/components/ozon-shipment-panel";

export const metadata: Metadata = { title: "Заказ — управление", robots: { index: false, follow: false } };

export default async function AdminOrderPage({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<{ saved?: string; delivery?: string }> }) {
  const [{ number }, query] = await Promise.all([params, searchParams]);
  const order = await prisma.order.findUnique({ where: { number }, include: { items: true, payment: true, shipment: { include: { ozonJob: true } }, user: true } });
  if (!order) notFound();
  const user = await getCurrentUser();
  const canDelete = user?.roles.includes("superadmin") || user?.permissions.has(PERMISSIONS.ordersWrite);
  const ozonPanel = order.shipment?.ozonJob && <OzonShipmentPanel job={order.shipment.ozonJob} number={order.number} />;
  return <>
    <div className="admin-header"><div><span className="eyebrow">{formatDate(order.createdAt)}</span><h1>{order.number}</h1></div><div className="admin-header__actions"><strong>{formatPrice(order.total)}</strong>{canDelete && <AdminDeleteOrder id={order.id} number={order.number} />}</div></div>
    {query.saved && <p className="notice notice--success">Статус сохранён.</p>}
    {query.delivery && <p className={`notice ${query.delivery === "error" ? "notice--danger" : "notice--success"}`} role="status">{query.delivery === "error" ? "Действие не подтверждено. Проверьте статус заказа, оплату и подключение Ozon." : "Проверка выполнена. Актуальный результат показан в блоке Ozon Доставки ниже."}</p>}
    <div className="admin-grid">
      <div className="admin-card"><h2>Состав заказа</h2>{order.items.map(item => <div key={item.id} style={{ padding: "14px 0", borderBottom: "1px solid var(--line)" }}><strong>{item.productName} × {item.quantity}</strong><br /><small>{item.sku}</small><span style={{ float: "right" }}>{formatPrice(item.totalPrice)}</span></div>)}</div>
      <div className="admin-card"><h2>Клиент</h2><p>{order.customerName}<br />{order.customerEmail}<br />{order.customerPhone}</p><p>{order.shippingAddress}</p><p>{order.customerComment}</p></div>
      <div className="admin-card"><h2>Статус производства</h2><form action={updateOrderStatusAction} className="form-grid"><input type="hidden" name="orderId" value={order.id} /><label className="field field--full"><span>Статус</span><select name="status" defaultValue={order.status}>{["NEW", "ESTIMATING", "APPROVED", "AWAITING_PAYMENT", "PAID", "QUEUED", "PRINTING", "POST_PROCESSING", "PACKED", "SHIPPED", "DELIVERED", "CANCELED", "REFUNDED"].map(status => <option key={status}>{status}</option>)}</select></label><label className="field field--full"><span>Внутренняя заметка</span><textarea name="note" defaultValue={order.internalNote ?? ""} /></label><button className="button" type="submit">Изменить статус</button></form></div>
      <div className="admin-card"><h2>Доставка</h2><p>{order.shipment?.method} · {formatPrice(order.shipment?.cost ?? 0)}</p><form action={updateTrackingAction} className="form-grid"><input type="hidden" name="orderId" value={order.id} /><label className="field field--full"><span>Трек-номер</span><input name="tracking" defaultValue={order.shipment?.tracking ?? ""} /></label><button className="button" type="submit">Сохранить трек</button></form><h2 style={{ marginTop: 30 }}>Оплата</h2><p>{order.payment?.provider} · {order.payment?.status}</p></div>
      {ozonPanel}
    </div>
  </>;
}
