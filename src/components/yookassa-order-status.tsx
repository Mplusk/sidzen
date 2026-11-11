import type { Prisma } from "@prisma/client";
import { reconcileYooKassaOrder } from "@/app/actions/yookassa-payment";

export function YooKassaOrderStatus({ payment, settlement, admin = false, expired = false, orderId, orderNumber }: {
  payment: { status: string; payload: Prisma.JsonValue; refundReviewRequired: boolean };
  settlement?: { status: string; externalId: string | null; errorCode: string | null } | null;
  admin?: boolean;
  expired?: boolean;
  orderId?: string;
  orderNumber?: string;
}) {
  const payload = payment.payload && typeof payment.payload === "object" && !Array.isArray(payment.payload) ? payment.payload : null;
  const receipt = payload && typeof payload.receiptStatus === "string" ? payload.receiptStatus : undefined;
  const reconciliationRequired = payload?.reconciliationRequired === true;
  const receiptStatus = receipt === "succeeded" ? "зарегистрирован" : receipt === "canceled" ? "ошибка регистрации — обратитесь в ЮKassa" : "проверяется";
  const settlementStatus: Record<string, string> = { PENDING: "ожидает отправки", SENDING: "отправляется", QUEUED: "ожидает регистрации", PROCESSED: "зарегистрирован", MANUAL_REVIEW: "требует сверки в ЮKassa", CANCELED: "отменён" };
  return <section className="admin-card"><h2>Оплата и чеки · ЮKassa</h2>
    <p>Оплата: {expired && payment.status === "PENDING" ? "время оплаты истекло" : ({ PENDING: "ожидается", AUTHORIZED: "проверяется", PAID: "подтверждена", CANCELED: "отменена", REFUNDED: "возвращена" } as Record<string, string>)[payment.status] ?? "проверяется"}.</p>
    {payment.status === "PAID" && <p>Чек предоплаты: {receiptStatus}.</p>}
    {settlement && <p>Чек зачёта: {settlementStatus[settlement.status] ?? "проверяется"}.{admin && settlement.externalId && <> ID: <code>{settlement.externalId}</code>.</>}</p>}
    {(reconciliationRequired || (admin && (payment.refundReviewRequired || settlement?.status === "MANUAL_REVIEW" || receipt === "canceled"))) && <p className="notice notice--danger">{admin ? "Требуется сверка оплаты и чеков в кабинете ЮKassa." : "Не удалось автоматически проверить платёж. Обратитесь в магазин и назовите номер заказа."}</p>}
    {admin && reconciliationRequired && orderId && orderNumber && <form action={reconcileYooKassaOrder} className="form-grid"><input type="hidden" name="orderId" value={orderId} /><label className="field">ID найденного платежа в ЮKassa<input name="externalId" required /></label><label className="field">Введите номер заказа для подтверждения<input name="confirmation" required placeholder={orderNumber} /></label><button className="button button--outline">Сверить платёж</button></form>}
    {admin && <p className="muted">Отмену платежа и возврат оформляйте в кабинете ЮKassa. Магазин проверяет результат; частичный возврат и связанные чеки требуют ручной сверки.</p>}
    <p className="muted">Электронные чеки ЮKassa отправляет на email заказа.</p>
  </section>;
}
