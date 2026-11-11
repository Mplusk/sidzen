import { continueYooKassaPayment } from "@/app/actions/yookassa-payment";
import { StockHoldNotice } from "@/components/stock-hold-notice";
import { canContinuePayment, type PaymentOrder } from "@/lib/payment-availability";
import styles from "./continue-payment.module.css";

export function ContinuePayment({ order, compact = false }: { order: PaymentOrder; compact?: boolean }) {
  if (!canContinuePayment(order)) return null;
  return <>
    <StockHoldNotice expiresAt={order.reservationExpiresAt?.toISOString() ?? null} />
    <form action={continueYooKassaPayment} className={compact ? styles.form : styles.standardForm}>
      <input type="hidden" name="number" value={order.number} />
      <button type="submit" className={compact ? styles.action : "button button--outline button--small"} aria-label={compact ? `Оплатить заказ ${order.number}` : `Перейти к оплате заказа ${order.number}`}>
        {compact ? "Оплатить" : "Перейти к оплате"} {compact && <span aria-hidden="true">→</span>}
      </button>
    </form>
  </>;
}
