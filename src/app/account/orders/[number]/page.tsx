import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate, formatPrice } from "@/lib/format";
import Link from "next/link";
import { configurationText } from "@/lib/product-options";
import { orderStatus } from "@/app/account/page";

export const metadata: Metadata = { title: "Заказ", robots: { index: false, follow: false } };

export default async function OrderPage({ params }: { params: Promise<{ number: string }> }) {
  const user = await requireUser();
  const { number } = await params;
  const order = await prisma.order.findFirst({ where: { number, userId: user.id }, include: { items: { include: { modelFile: true } }, shipment: true, payment: true } });
  if (!order) notFound();
  return <><span className="eyebrow">{formatDate(order.createdAt)}</span><h1 style={{ fontSize: "3.2rem" }}>Заказ {order.number}</h1><p><span className="status">{orderStatus(order.status)}</span></p><div className="admin-grid"><div className="admin-card"><h2>Состав</h2>{order.items.map((item) => <div key={item.id} style={{ display: "flex", justifyContent: "space-between", gap: 20, padding: "12px 0", borderBottom: "1px solid var(--line)" }}><span><strong>{item.productName}</strong><br /><small>{item.sku ?? item.modelFile?.originalName}</small><br /><small>{configurationText(item.configuration)}</small></span><strong>{item.quantity} × {formatPrice(item.unitPrice)}</strong></div>)}<p>Товары: {formatPrice(order.subtotal)} · Доставка: {formatPrice(order.deliveryPrice)}</p><div className="quote-total"><span>Итого</span><strong>{formatPrice(order.total)}</strong></div></div><div className="admin-card"><h2>Доставка и оплата</h2><p>{order.shippingAddress}</p><p><strong>{order.shipment?.method}</strong><br />Трек: {order.shipment?.tracking ?? "появится после отправки"}</p><p>Оплата: {order.payment?.status === "PAID" ? "Оплачено" : order.payment?.status === "CANCELED" ? "Отменена" : "Ожидается"}</p>{order.payment?.provider === "yookassa" && order.payment.status === "PENDING" && <Link className="button" href={`/checkout/success/${order.number}/`}>Перейти к оплате</Link>}</div></div></>;
}
