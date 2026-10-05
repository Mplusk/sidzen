import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatPrice } from "@/lib/format";
import { configurationText } from "@/lib/product-options";
import { canAccessOrder } from "@/lib/order-access";
import { isOnlineProvider, refreshPayment } from "@/lib/payments";
import { payOrderAction } from "@/app/actions/payment";

export const metadata: Metadata = { title: "Заказ принят", robots: { index: false, follow: false } };

export default async function SuccessPage({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<{ error?: string }> }) {
  const [{ number }, query] = await Promise.all([params, searchParams]);
  let order = await prisma.order.findUnique({ where: { number }, include: { items: true, shipment: true, payment: true } });
  if (!order || !(await canAccessOrder(order))) notFound();
  if (isOnlineProvider(order.payment?.provider) && order.payment?.externalId && ["PENDING", "AUTHORIZED"].includes(order.payment.status)) {
    await refreshPayment(order.payment.externalId).catch(() => undefined);
    order = await prisma.order.findUniqueOrThrow({ where: { number }, include: { items: true, shipment: true, payment: true } });
  }
  const paid = order.payment?.status === "PAID";
  return <div className="auth-shell"><div className="auth-card order-confirmation"><span className="eyebrow">{paid ? "Заказ оплачен" : "Заказ принят"}</span><h1>Спасибо!</h1><p>Номер заказа: <strong>{order.number}</strong></p><ul className="checkout-items">{order.items.map((item) => <li key={item.id}><strong>{item.productName} × {item.quantity}</strong><small>{configurationText(item.configuration)}</small><span>{formatPrice(item.totalPrice)}</span></li>)}</ul><div className="summary-line"><span>Товары</span><strong>{formatPrice(order.subtotal)}</strong></div><div className="summary-line"><span>Доставка · {order.shipment?.method}</span><strong>{formatPrice(order.deliveryPrice)}</strong></div><div className="summary-line summary-line--total"><span>Итого</span><strong>{formatPrice(order.total)}</strong></div>
    {query.error && <p className="notice" role="alert">Не удалось открыть оплату. Заказ сохранён, повторное оформление не требуется. Попробуйте оплатить ещё раз или свяжитесь с магазином.</p>}
    {isOnlineProvider(order.payment?.provider) && order.payment?.status === "PENDING" && <><p className="muted">Статус обновляется после подтверждения банка. Если уже оплатили, обновите страницу через минуту.</p><form action={payOrderAction}><input type="hidden" name="orderId" value={order.id} /><button className="button">Оплатить заказ</button></form></>}
    {!paid && order.payment?.provider === "manual" && <p className="notice">Заказ ожидает подтверждения. Реквизиты для оплаты по счёту согласуем по указанным контактам.</p>}
    {order.payment?.status === "CANCELED" && <p className="notice">Платёж отменён. Свяжитесь с магазином для повторной оплаты.</p>}
    <div className="confirm-dialog__actions"><Link className="button button--outline" href="/account/orders/">Мои заказы</Link><Link className="button" href="/catalog/">В каталог</Link></div>
  </div></div>;
}
