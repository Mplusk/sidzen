import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate, formatPrice } from "@/lib/format";
import { configurationText } from "@/lib/product-options";
import { FiscalReceipts } from "@/components/fiscal-receipts";
import { orderStatus } from "@/lib/order-status";
import { YooKassaOrderStatus } from "@/components/yookassa-order-status";
import { continueYooKassaPayment } from "@/app/actions/yookassa-payment";
import { dashboardDelivery } from "@/lib/dashboard-delivery";
import { estimatedDelivery } from "@/lib/delivery/estimated-date";
import { DeliveryEstimate } from "@/components/delivery-estimate";
import { CartAvailabilityRefresh } from "@/components/cart-availability-refresh";
import { StockHoldNotice } from "@/components/stock-hold-notice";

export const metadata: Metadata = { title: "Заказ", robots: { index: false, follow: false } };

export default async function OrderPage({ params }: { params: Promise<{ number: string }> }) {
  const user = await requireUser();
  const { number } = await params;
  const order = await prisma.order.findFirst({ where: { number, userId: user.id }, include: { items: true, shipment: { include: { ozonJob: { select: { status: true, request: true, response: true, cancelRequestedAt: true } }, cdekJob: { select: { status: true, deliveryStatus: true, deliveryStatusChangedAt: true, cancelRequestedAt: true } } } }, payment: true, yookassaSettlement: true, fiscalReceipts: { orderBy: { createdAt: "asc" } } } });
  if (!order || (order.deletedAt && order.kind === "APPLICATION")) notFound();
  const needsReview = Boolean(order.payment?.payload && typeof order.payment.payload === "object" && !Array.isArray(order.payment.payload) && order.payment.payload.reconciliationRequired === true);
  const pendingPayment = order.payment?.provider === "yookassa-online" && order.payment.status === "PENDING";
  const processingPayment = order.payment?.provider === "yookassa-online" && order.payment.status === "AUTHORIZED";
  const reservationOverdue = Boolean(order.reservationExpiredAt || (order.reservationExpiresAt && order.reservationExpiresAt <= new Date()));
  return <><CartAvailabilityRefresh enabled={pendingPayment || processingPayment} /><StockHoldNotice expiresAt={pendingPayment && !reservationOverdue ? order.reservationExpiresAt?.toISOString() ?? null : null} /><span className="eyebrow">{formatDate(order.createdAt)}</span><h1 style={{ fontSize: "3.2rem" }}>{order.kind === "APPLICATION" ? "Заявка" : "Заказ"} {order.number}</h1><p><span className="status">{orderStatus(order.status)}</span></p>{order.kind === "APPLICATION" && <p className="notice">Продавец свяжется с вами для согласования. Оплата на сайте не проводится.</p>}{processingPayment && <p className="notice">Оплата обрабатывается. Статус обновится автоматически.</p>}{pendingPayment && reservationOverdue && <p className="notice">Время резерва истекло. Чтобы оформить новый заказ, вернитесь в каталог. Если оплата уже завершена, свяжитесь с магазином.</p>}{pendingPayment && !needsReview && !reservationOverdue && !order.deletedAt && <form action={continueYooKassaPayment}><input type="hidden" name="number" value={order.number} /><button className="button">Перейти к оплате</button></form>}{order.deletedAt && <p className="notice">Заказ удалён из списка. Документы ранее состоявшейся покупки сохранены.</p>}<div className="admin-grid"><div className="admin-card"><h2>Состав</h2>{order.items.map(item => <div key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 20, padding: "12px 0", borderBottom: "1px solid var(--line)" }}><span><strong>{item.productName}</strong><br /><small>{item.sku}</small><br /><small>{configurationText(item.configuration)}</small></span><strong>{item.quantity} × {formatPrice(item.unitPrice)}</strong></div>)}<p>Товары: {formatPrice(order.subtotal)} · Доставка: {formatPrice(order.deliveryPrice)}</p><div className="quote-total"><span>Итого</span><strong>{formatPrice(order.total)}</strong></div></div><div className="admin-card"><h2>Доставка и контакты</h2><p>{order.shippingAddress}</p><p><strong>{order.shipment?.method}</strong><br />{dashboardDelivery(order.shipment).label}<br />Трек: {order.shipment?.tracking || "появится после согласования и отправки"}</p><DeliveryEstimate estimate={estimatedDelivery(order.shipment, order.status)} /><p>{order.customerName}<br />{order.customerPhone}<br />{order.customerEmail}</p></div>{order.payment?.provider === "yookassa-online" && <YooKassaOrderStatus payment={order.payment} settlement={order.yookassaSettlement} />}<FiscalReceipts receipts={order.fiscalReceipts} orderId={order.id} /></div></>;
}
