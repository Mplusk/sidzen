// Compatibility for payments created before the migration to Tochka.
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getPaymentConfig } from "@/lib/integrations";
import { operatorReady } from "@/lib/privacy";

export async function onlinePaymentReady() {
  const config = await getPaymentConfig();
  return config.enabled && Boolean(config.shopId && config.secret) && (config.receiptMode === "external" || /^(?:[1-9]|1[0-2])$/.test(config.vatCode));
}

const paymentSchema = z.object({ id: z.string().uuid(), status: z.enum(["pending", "waiting_for_capture", "succeeded", "canceled"]), paid: z.boolean(), test: z.boolean().optional(), amount: z.object({ value: z.string(), currency: z.literal("RUB") }), metadata: z.object({ orderId: z.string() }), confirmation: z.object({ confirmation_url: z.url().optional() }).optional(), recipient: z.object({ account_id: z.string() }).optional() });
export type VerifiedPayment = z.infer<typeof paymentSchema>;

async function requestPayment(path: string, options?: { body: object; key: string }) {
  const config = await getPaymentConfig();
  if (!config.shopId || !config.secret || (options && !await onlinePaymentReady())) throw new Error("payment-not-configured");
  const response = await fetch(`https://api.yookassa.ru/v3/${path}`, { method: options ? "POST" : "GET", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { Authorization: `Basic ${Buffer.from(`${config.shopId}:${config.secret}`).toString("base64")}`, "Content-Type": "application/json", ...(options ? { "Idempotence-Key": options.key } : {}) }, ...(options ? { body: JSON.stringify(options.body) } : {}) });
  if (!response.ok) throw new Error(`payment-provider-${response.status}`);
  return paymentSchema.parse(await response.json());
}

export async function createOnlinePayment(orderId: string) {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { payment: true, items: true } });
  const payment = order.payment;
  if (!payment || payment.provider !== "yookassa" || payment.status !== "PENDING") throw new Error("payment-state");
  if (payment.externalId) {
    const remote = await requestPayment(`payments/${payment.externalId}`);
    await applyVerifiedPayment(remote);
    return paymentUrl(remote);
  }
  if (!await operatorReady()) throw new Error("personal-data-not-ready");
  // The provider keeps idempotency keys for 24 hours. Never repeat an ambiguous
  // create request outside that window: an operator must reconcile it first.
  if (Date.now() - order.createdAt.getTime() > 23 * 60 * 60 * 1000) throw new Error("payment-reconciliation-required");
  const config = await getPaymentConfig();
  const vatCode = Number(config.vatCode);
  const receipt = config.receiptMode === "external" ? undefined : {
    customer: { email: order.customerEmail },
    ...(config.taxSystemCode ? { tax_system_code: Number(config.taxSystemCode) } : {}),
    items: [...order.items.map((item) => ({ description: item.productName.slice(0, 128), quantity: String(item.quantity), amount: { value: Number(item.unitPrice).toFixed(2), currency: "RUB" }, vat_code: vatCode, payment_mode: "full_payment", payment_subject: "commodity" })), ...(Number(order.deliveryPrice) > 0 ? [{ description: "Доставка", quantity: "1", amount: { value: Number(order.deliveryPrice).toFixed(2), currency: "RUB" }, vat_code: vatCode, payment_mode: "full_payment", payment_subject: "service" }] : [])],
  };
  const remote = await requestPayment("payments", { key: payment.id, body: { amount: { value: Number(order.total).toFixed(2), currency: "RUB" }, capture: true, confirmation: { type: "redirect", return_url: `${process.env.NEXT_PUBLIC_SITE_URL ?? "https://sidzen.shop"}/checkout/success/${order.number}/` }, description: `Заказ ${order.number}`, metadata: { orderId: order.id }, ...(receipt ? { receipt } : {}) } });
  if (remote.metadata.orderId !== order.id || Number(remote.amount.value) !== Number(order.total)) throw new Error("payment-mismatch");
  await prisma.payment.update({ where: { id: payment.id }, data: { externalId: remote.id } });
  await applyVerifiedPayment(remote);
  return paymentUrl(remote);
}

function paymentUrl(payment: VerifiedPayment) {
  const value = payment.confirmation?.confirmation_url;
  if (!value || payment.status !== "pending") return null;
  const url = new URL(value);
  if (url.protocol !== "https:" || !["yookassa.ru", "yoomoney.ru"].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new Error("payment-url");
  return url.href;
}

export async function refreshPayment(id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new Error("payment-id");
  return applyVerifiedPayment(await requestPayment(`payments/${id}`));
}

export async function applyVerifiedPayment(remote: VerifiedPayment) {
  if (remote.test && process.env.YOOKASSA_ALLOW_TEST !== "true") throw new Error("test-payment-rejected");
  const config = await getPaymentConfig();
  if (remote.recipient && remote.recipient.account_id !== config.shopId) throw new Error("payment-recipient");
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { orderId: remote.metadata.orderId }, include: { order: true } });
    if (!payment) return;
    if (payment.provider !== "yookassa" || (payment.externalId && payment.externalId !== remote.id) || remote.amount.currency !== "RUB" || Number(remote.amount.value) !== Number(payment.amount) || Number(payment.amount) !== Number(payment.order.total)) throw new Error("payment-mismatch");
    const status = remote.status === "succeeded" && remote.paid ? "PAID" : remote.status === "canceled" ? "CANCELED" : null;
    if (!status) return;
    const updated = await tx.payment.updateMany({ where: { id: payment.id, status: { in: ["PENDING", "AUTHORIZED"] } }, data: { status, externalId: remote.id, ...(status === "PAID" ? { paidAt: new Date() } : {}) } });
    if (!updated.count) return;
    if (status === "PAID") await tx.order.updateMany({ where: { id: payment.orderId, status: { in: ["NEW", "APPROVED", "AWAITING_PAYMENT"] } }, data: { status: "PAID" } });
    await tx.auditLog.create({ data: { action: "payment.verified", entityType: "Payment", entityId: payment.id, after: { externalId: remote.id, status } } });
  });
}
