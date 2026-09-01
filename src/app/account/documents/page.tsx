import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { formatDate, formatPrice } from "@/lib/format";

export const metadata: Metadata = { title: "Документы", robots: { index: false, follow: false } };

export default async function DocumentsPage() {
  const user = await requireUser();
  const orders = await prisma.order.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
  return <><span className="eyebrow">Чеки и счета</span><h1>Документы</h1><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Документ</th><th>Дата</th><th>Сумма</th><th>Статус</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td>Заказ {order.number}</td><td>{formatDate(order.createdAt)}</td><td>{formatPrice(order.total)}</td><td>{["PAID", "QUEUED", "PRINTING", "POST_PROCESSING", "PACKED", "SHIPPED", "DELIVERED"].includes(order.status) ? "Чек доступен после подключения кассы" : "Ожидает оплаты"}</td></tr>)}</tbody></table></div></>;
}
