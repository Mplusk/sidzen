import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatPrice } from "@/lib/format";
import { configurationText } from "@/lib/product-options";
import { canAccessOrder } from "@/lib/order-access";
import { FiscalReceipts } from "@/components/fiscal-receipts";
import { continueYooKassaPayment } from "@/app/actions/yookassa-payment";
import { YooKassaOrderStatus } from "@/components/yookassa-order-status";
import { StockHoldNotice } from "@/components/stock-hold-notice";
import { CartAvailabilityRefresh } from "@/components/cart-availability-refresh";

export const metadata: Metadata = { title: "Заявка принята", robots: { index: false, follow: false } };

export default async function SuccessPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const order = await prisma.order.findUnique({ where: { number }, include: { items: true, shipment: true, payment: true, yookassaSettlement: true, fiscalReceipts: { orderBy: { createdAt: "asc" } } } });
  if (!order || (order.deletedAt && order.kind === "APPLICATION") || !(await canAccessOrder(order))) notFound();
  const online = order.payment?.provider === "yookassa-online";
  const needsReview = Boolean(order.payment?.payload && typeof order.payment.payload === "object" && !Array.isArray(order.payment.payload) && order.payment.payload.reconciliationRequired === true);
  const reservationOverdue = Boolean(order.payment?.status === "PENDING" && order.reservationExpiresAt && order.reservationExpiresAt <= new Date());
  return <div className="auth-shell"><div className="auth-card order-confirmation"><span className="eyebrow">{order.kind === "APPLICATION" ? "Заявка принята" : "Заказ сохранён"}</span><h1>Спасибо!</h1><p>Номер: <strong>{order.number}</strong></p><p className={`notice ${order.stockReviewRequired ? "notice--danger" : "notice--success"}`}>{order.stockReviewRequired ? "Оплата получена после окончания резерва. Магазин проверяет наличие и свяжется с вами." : order.kind === "APPLICATION" ? "Заявка передана продавцу. Он свяжется с вами по указанным контактам, чтобы согласовать заказ. Оплачивать на сайте ничего не нужно." : online && order.payment?.status === "PAID" ? "Оплата подтверждена. Чек отправляется на email заказа." : online && order.payment?.status === "AUTHORIZED" ? "Оплата обрабатывается. Статус обновится автоматически." : order.reservationExpiredAt || reservationOverdue ? "Время резерва истекло. Чтобы оформить новый заказ, вернитесь в каталог. Если оплата уже завершена, свяжитесь с магазином." : online && order.payment?.status === "CANCELED" ? "Платёж отменён. Для нового заказа обратитесь в магазин." : online ? "Заказ сохранён; оплату пока не удалось подтвердить. Проверьте статус или перейдите к оплате." : "Информация о заказе сохранена. По дальнейшим действиям свяжитесь с продавцом."}</p>{online && !needsReview && !order.reservationExpiredAt && !reservationOverdue && order.payment?.status === "PENDING" && <form action={continueYooKassaPayment}><input type="hidden" name="number" value={order.number} /><button className="button">Перейти к оплате</button></form>}<ul className="checkout-items">{order.items.map(item => <li key={item.id}><strong>{item.productName} × {item.quantity}</strong><small>{configurationText(item.configuration)}</small><span>{formatPrice(item.totalPrice)}</span></li>)}</ul><div className="summary-line"><span>Товары</span><strong>{formatPrice(order.subtotal)}</strong></div><div className="summary-line"><span>Доставка · {order.shipment?.method}</span><strong>{formatPrice(order.deliveryPrice)}</strong></div><div className="summary-line summary-line--total"><span>Итого</span><strong>{formatPrice(order.total)}</strong></div><p>{order.customerName}<br />{order.customerPhone}<br />{order.customerEmail}</p><p className="muted">{order.shippingAddress}</p>
    <CartAvailabilityRefresh /><StockHoldNotice expiresAt={online && order.payment?.status === "PENDING" && !reservationOverdue ? order.reservationExpiresAt?.toISOString() ?? null : null} />
    <FiscalReceipts receipts={order.fiscalReceipts} orderId={order.id} />
    {online && order.payment && <YooKassaOrderStatus payment={order.payment} settlement={order.yookassaSettlement} />}
    <div className="confirm-dialog__actions"><Link className="button button--outline" href="/account/orders/">Мои заказы</Link><Link className="button" href="/">В каталог</Link></div>
  </div></div>;
}
