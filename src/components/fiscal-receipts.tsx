import { SubmitButton } from "@/components/submit-button";
import { checkFiscalOrder, reconcileFiscalReceipt } from "@/app/actions/cloudkassir";
import { safeReceiptUrl } from "@/lib/cloudkassir/client";
import { formatDate } from "@/lib/format";

type Receipt = { id: string; kind: string; status: string; receiptUrl: string | null; externalId: string | null; errorCode: string | null; processedAt: Date | null; firstAttemptAt: Date | null };
const kinds: Record<string, string> = { PREPAYMENT: "Предоплата 100%", SETTLEMENT: "Полный расчёт · зачёт предоплаты", REFUND: "Возврат прихода" };
const statuses: Record<string, string> = { WAITING_PAYMENT: "Ожидает подтверждения оплаты", PENDING: "Ожидает отправки в кассу", SENDING: "Отправлен · проверяем результат", QUEUED: "Принят CloudKassir · ожидает фискализации", PROCESSED: "Чек сформирован", MANUAL_REVIEW: "Нужна сверка продавцом", CANCELED: "Оплата отменена · чек не требуется" };
const errors: Record<string, string> = { configuration: "Проверьте подключение CloudKassir.", "previous-receipt": "Сначала должен сформироваться предыдущий чек.", temporary: "Сервис временно недоступен. Повторная проверка выполняется автоматически.", "uncertain-submission": "Ответ потерян. Повторная выдача остановлена для защиты от дубля. Найдите чек в CloudKassir по InvoiceId ниже.", "provider-status": "CloudKassir не подтвердил фискализацию. Сверьте чек и состояние кассы.", "provider-rejected": "Касса отклонила запрос. Уточните причину в CloudKassir; не создавайте новый чек без сверки.", "partial-refund": "Банк сообщил о частичном возврате. Позиции возврата и чеки нужно сверить вручную.", "refund-reconciliation": "Возврат обнаружен без подтверждённого полного цикла оплаты. Нужна ручная сверка чеков." };
export function FiscalReceipts({ receipts, orderId, admin = false, partialRefund = false }: { receipts: Receipt[]; orderId: string; admin?: boolean; partialRefund?: boolean }) {
  if (!receipts.length) return null;
  return <section className="admin-card"><h2>Кассовые чеки</h2><p className="muted">Оплата — Точка. Чеки — CloudKassir. Электронные чеки направляются на email заказа.</p>
    {partialRefund && admin && <p role="alert" className="notice notice--danger">Возврат требует ручной сверки. Автоматический зачёт / возврат заблокирован. Оформите необходимые чеки в кассе по фактически возвращённым позициям; статус банка не заменяет кассовый чек.</p>}
    {receipts.map(row => <div key={row.id} className="content-card"><strong>{kinds[row.kind] ?? "Чек"}</strong><p>{admin ? statuses[row.status] ?? "Проверяется" : row.status === "PROCESSED" ? "Чек сформирован" : row.status === "CANCELED" ? "Оплата отменена" : "Чек готовится"}{row.processedAt && ` · ${formatDate(row.processedAt)}`}</p>
      {row.status === "PROCESSED" && safeReceiptUrl(row.receiptUrl) && <a className="text-link" href={safeReceiptUrl(row.receiptUrl)!} target="_blank" rel="noreferrer">Открыть чек →</a>}
      {admin && <><p><small>InvoiceId: <code>{row.id}</code>{row.externalId && <> · ID CloudKassir: <code>{row.externalId}</code></>}</small></p>{row.errorCode && <p className="notice">{errors[row.errorCode] ?? "Нужна проверка кассы."}</p>}
        {row.status === "MANUAL_REVIEW" && row.firstAttemptAt && <form action={reconcileFiscalReceipt} className="form-grid"><input type="hidden" name="receiptId" value={row.id} /><label className="field">ID уже сформированного чека CloudKassir<input name="externalId" required maxLength={100} defaultValue={row.externalId ?? ""} /></label><label><input type="checkbox" name="confirmation" value={row.id} required /> Подтверждаю сверку этого чека</label><SubmitButton className="button button--outline" pendingLabel="Проверяем…">Сверить без создания нового чека</SubmitButton></form>}
      </>}
    </div>)}
    {admin && <><form action={checkFiscalOrder}><input type="hidden" name="orderId" value={orderId} /><SubmitButton className="button button--outline" pendingLabel="Проверяем…">Проверить оплату и чеки</SubmitButton></form><p className="muted">Неизвестные / отклонённые чеки не отправляются заново вслепую. Если чек ещё не пробит и нужна коррекция, согласуйте её с CloudKassir и оформите в кассе вручную. Для старых заказов до подключения автоматические чеки не создаются.</p></>}
  </section>;
}
