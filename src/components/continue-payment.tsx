import { continueYooKassaPayment } from "@/app/actions/yookassa-payment";
import { StockHoldNotice } from "@/components/stock-hold-notice";
import { canContinuePayment, type PaymentOrder } from "@/lib/payment-availability";
import styles from "./continue-payment.module.css";

export function ContinuePayment({ order }: { order: PaymentOrder }) {
  if (!canContinuePayment(order)) return null;
  return <>
    <StockHoldNotice expiresAt={order.reservationExpiresAt?.toISOString() ?? null} />
    <form action={continueYooKassaPayment} className={styles.form}>
      <input type="hidden" name="number" value={order.number} />
      <button type="submit" className={styles.action} aria-label={`Перейти к оплате заказа ${order.number}`}>
        Оплатить <span aria-hidden="true">→</span>
      </button>
    </form>
  </>;
}
