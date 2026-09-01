import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatPrice } from "@/lib/format";

export const metadata: Metadata = { title: "Заказ принят", robots: { index: false, follow: false } };

export default async function SuccessPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const order = await prisma.order.findUnique({ where: { number }, include: { items: true, shipment: true } });
  if (!order) notFound();
  return <div className="auth-shell"><div className="auth-card" style={{ width: "min(620px, 100%)" }}><span className="eyebrow">Заказ принят</span><h1>Спасибо!</h1><p>Номер заказа: <strong>{order.number}</strong></p><p>Сумма: <strong>{formatPrice(order.total)}</strong>. Мы проверим параметры печати и свяжемся по адресу {order.customerEmail}.</p><p className="notice">Оплата включится после подтверждения заказа менеджером. Повторный платёж не создаёт дубль заказа.</p><div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}><Link className="button" href="/register/">Создать кабинет</Link><Link className="button button--ghost" href="/catalog/">Вернуться в каталог</Link></div></div></div>;
}
