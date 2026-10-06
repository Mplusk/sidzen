import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate, formatPrice } from "@/lib/format";
import Link from "next/link";

export const metadata: Metadata = { title: "Документы", robots: { index: false, follow: false } };

export default async function DocumentsPage() {
  const user = await requireUser();
  const orders = await prisma.order.findMany({ where: { userId: user.id, fiscalReceipts: { some: {} } }, include: { fiscalReceipts: { select: { status: true } } }, orderBy: { createdAt: "desc" } });
  return <><span className="eyebrow">Документы прежних покупок</span><h1>Документы</h1><p className="muted">Новые заявки не проводят оплату на сайте и не создают чеков автоматически. Документы по согласованной покупке предоставит продавец.</p>{orders.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Документ</th><th>Дата</th><th>Сумма</th><th>Статус</th></tr></thead><tbody>{orders.map(order => <tr key={order.id}><td><Link href={`/account/orders/${order.number}/`}>Документы заказа {order.number}</Link></td><td>{formatDate(order.createdAt)}</td><td>{formatPrice(order.total)}</td><td>{order.fiscalReceipts.some(receipt => receipt.status === "PROCESSED") ? "Чек сформирован" : "Проверяется"}</td></tr>)}</tbody></table></div> : <p className="notice">Документов, сформированных на сайте, пока нет.</p>}</>;
}
