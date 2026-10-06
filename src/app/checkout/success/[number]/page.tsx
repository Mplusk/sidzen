import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatPrice } from "@/lib/format";
import { configurationText } from "@/lib/product-options";
import { canAccessOrder } from "@/lib/order-access";
import { FiscalReceipts } from "@/components/fiscal-receipts";

export const metadata: Metadata = { title: "Заявка принята", robots: { index: false, follow: false } };

export default async function SuccessPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const order = await prisma.order.findUnique({ where: { number }, include: { items: true, shipment: true, fiscalReceipts: { orderBy: { createdAt: "asc" } } } });
  if (!order || (order.deletedAt && order.kind === "APPLICATION") || !(await canAccessOrder(order))) notFound();
  return <div className="auth-shell"><div className="auth-card order-confirmation"><span className="eyebrow">{order.kind === "APPLICATION" ? "Заявка принята" : "Заказ сохранён"}</span><h1>Спасибо!</h1><p>Номер: <strong>{order.number}</strong></p><p className="notice notice--success">{order.kind === "APPLICATION" ? "Заявка передана продавцу. Он свяжется с вами по указанным контактам, чтобы согласовать заказ. Оплачивать на сайте ничего не нужно." : "Информация о заказе сохранена. По дальнейшим действиям свяжитесь с продавцом — оплата на сайте больше не проводится."}</p><ul className="checkout-items">{order.items.map(item => <li key={item.id}><strong>{item.productName} × {item.quantity}</strong><small>{configurationText(item.configuration)}</small><span>{formatPrice(item.totalPrice)}</span></li>)}</ul><div className="summary-line"><span>Товары</span><strong>{formatPrice(order.subtotal)}</strong></div><div className="summary-line"><span>Доставка · {order.shipment?.method}</span><strong>{formatPrice(order.deliveryPrice)}</strong></div><div className="summary-line summary-line--total"><span>Стоимость товаров</span><strong>{formatPrice(order.total)}</strong></div><p>{order.customerName}<br />{order.customerPhone}<br />{order.customerEmail}</p><p className="muted">{order.shippingAddress}</p>
    <FiscalReceipts receipts={order.fiscalReceipts} orderId={order.id} />
    <div className="confirm-dialog__actions"><Link className="button button--outline" href="/account/orders/">Мои заказы</Link><Link className="button" href="/catalog/">В каталог</Link></div>
  </div></div>;
}
