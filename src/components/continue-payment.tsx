import { continueYooKassaPayment } from "@/app/actions/yookassa-payment";
import { StockHoldNotice } from "@/components/stock-hold-notice";
import { canContinuePayment, type PaymentOrder } from "@/lib/payment-availability";

export function ContinuePayment({ order }: { order: PaymentOrder }) {
  if (!canContinuePayment(order)) return null;
  return <><StockHoldNotice expiresAt={order.reservationExpiresAt?.toISOString() ?? null} /><form action={continueYooKassaPayment} style={{ marginTop: 8 }}><input type="hidden" name="number" value={order.number} /><button className="button button--outline button--small">Перейти к оплате</button></form></>;
}
