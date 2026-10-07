import { prisma } from "@/lib/prisma";
import { configurationText } from "@/lib/product-options";
import { formatPrice } from "@/lib/format";

export async function sendOrderConfirmation(orderId: string) {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true, shipment: true, notifications: { where: { channel: "email", template: "order-confirmation" } } } });
  const notice = order.notifications[0];
  if (!notice || notice.status === "SENT") return;
  // Explicit operator review is required before any foreign processor receives PD.
  if (process.env.RESEND_PERSONAL_DATA_TRANSFER_APPROVED !== "true" || !process.env.RESEND_API_KEY || !process.env.ORDER_EMAIL_FROM) {
    await prisma.orderNotification.update({ where: { id: notice.id }, data: { status: "NOT_CONFIGURED", error: "Email provider not configured or personal-data transfer not approved" } });
    return;
  }
  const text = [`${order.kind === "APPLICATION" ? "Заявка" : "Заказ"} ${order.number} принята.`, ...order.items.map(item => `${item.productName} × ${item.quantity}\n${configurationText(item.configuration)}\n${formatPrice(item.totalPrice)}`), `Товары: ${formatPrice(order.subtotal)}`, `Доставка (${order.shipment?.method}): ${formatPrice(order.deliveryPrice)}`, `Стоимость товаров: ${formatPrice(order.total)}`, `Адрес: ${order.shippingAddress}`, "Продавец свяжется с вами для согласования. Оплата на сайте не проводится."].join("\n\n");
  try {
    const response = await fetch("https://api.resend.com/emails", { method: "POST", signal: AbortSignal.timeout(10_000), headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": notice.id }, body: JSON.stringify({ from: process.env.ORDER_EMAIL_FROM, to: [order.customerEmail], subject: `${order.kind === "APPLICATION" ? "Заявка" : "Заказ"} ${order.number} — SIDZEN`, text }) });
    if (!response.ok) throw new Error(`email-provider-${response.status}`);
    await prisma.orderNotification.update({ where: { id: notice.id }, data: { status: "SENT", sentAt: new Date(), error: null } });
  } catch (error) {
    await prisma.orderNotification.update({ where: { id: notice.id }, data: { status: "FAILED", error: error instanceof Error ? error.message.slice(0, 200) : "email-error" } });
  }
}
