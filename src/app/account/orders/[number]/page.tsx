import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate, formatPrice } from "@/lib/format";
import { configurationText } from "@/lib/product-options";
import { FiscalReceipts } from "@/components/fiscal-receipts";
import { orderStatus } from "@/lib/order-status";

export const metadata: Metadata = { title: "Заказ", robots: { index: false, follow: false } };

export default async function OrderPage({ params }: { params: Promise<{ number: string }> }) {
  const user = await requireUser();
  const { number } = await params;
  const order = await prisma.order.findFirst({ where: { number, userId: user.id }, include: { items: true, shipment: true, payment: true, fiscalReceipts: { orderBy: { createdAt: "asc" } } } });
  if (!order || (order.deletedAt && order.kind === "APPLICATION")) notFound();
  return <><span className="eyebrow">{formatDate(order.createdAt)}</span><h1 style={{ fontSize: "3.2rem" }}>{order.kind === "APPLICATION" ? "Заявка" : "Заказ"} {order.number}</h1><p><span className="status">{orderStatus(order.status)}</span></p>{order.kind === "APPLICATION" && <p className="notice">Продавец свяжется с вами для согласования. Оплата на сайте не проводится.</p>}{order.deletedAt && <p className="notice">Заказ удалён из списка. Документы ранее состоявшейся покупки сохранены.</p>}<div className="admin-grid"><div className="admin-card"><h2>Состав</h2>{order.items.map(item => <div key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 20, padding: "12px 0", borderBottom: "1px solid var(--line)" }}><span><strong>{item.productName}</strong><br /><small>{item.sku}</small><br /><small>{configurationText(item.configuration)}</small></span><strong>{item.quantity} × {formatPrice(item.unitPrice)}</strong></div>)}<p>Товары: {formatPrice(order.subtotal)} · Доставка: {formatPrice(order.deliveryPrice)}</p><div className="quote-total"><span>Итого</span><strong>{formatPrice(order.total)}</strong></div></div><div className="admin-card"><h2>Доставка и контакты</h2><p>{order.shippingAddress}</p><p><strong>{order.shipment?.method}</strong><br />Трек: {order.shipment?.tracking || "появится после согласования и отправки"}</p><p>{order.customerName}<br />{order.customerPhone}<br />{order.customerEmail}</p></div><FiscalReceipts receipts={order.fiscalReceipts} orderId={order.id} /></div></>;
}
