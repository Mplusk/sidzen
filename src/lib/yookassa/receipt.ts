/** Payloads for the «Чеки от ЮKassa» service, not a third-party cashbox. */
export type ReceiptOrder = {
  customerEmail: string;
  total: number | { toString(): string };
  deliveryPrice: number | { toString(): string };
  items: Array<{ productName: string; quantity: number; unitPrice: number | { toString(): string } }>;
};

function kopecks(value: number | { toString(): string }) {
  const text = String(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error("receipt-amount");
  const [rubles, fractional = ""] = text.split(".");
  const result = Number(rubles) * 100 + Number(fractional.padEnd(2, "0"));
  if (!Number.isSafeInteger(result)) throw new Error("receipt-amount");
  return result;
}

function money(value: number) { return { value: `${Math.floor(value / 100)}.${String(value % 100).padStart(2, "0")}`, currency: "RUB" as const }; }

export function receiptForOrder(order: ReceiptOrder, mode: "full_prepayment" | "full_payment") {
  if (!order.customerEmail || !order.items.length) throw new Error("receipt-details");
  let sum = 0;
  const items = order.items.map(item => {
    const price = kopecks(item.unitPrice);
    if (!item.productName.trim() || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || price < 1) throw new Error("receipt-item");
    sum += price * item.quantity;
    return { description: item.productName.trim().slice(0, 128), quantity: item.quantity, amount: money(price), vat_code: 1, payment_mode: mode, payment_subject: "commodity" as const };
  });
  const delivery = kopecks(order.deliveryPrice);
  const result: Array<{ description: string; quantity: number; amount: ReturnType<typeof money>; vat_code: number; payment_mode: typeof mode; payment_subject: "commodity" | "service" }> = items;
  if (delivery) { sum += delivery; result.push({ description: "Доставка", quantity: 1, amount: money(delivery), vat_code: 1, payment_mode: mode, payment_subject: "service" }); }
  if (result.length > 80 || !Number.isSafeInteger(sum) || sum !== kopecks(order.total)) throw new Error("receipt-total");
  return { customer: { email: order.customerEmail }, items: result };
}

export function settlementForOrder(order: ReceiptOrder, paymentId: string) {
  if (!paymentId) throw new Error("receipt-payment");
  return { ...receiptForOrder(order, "full_payment"), payment_id: paymentId, type: "payment" as const, send: true, settlements: [{ type: "prepayment" as const, amount: money(kopecks(order.total)) }] };
}
