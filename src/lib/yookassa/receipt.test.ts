import { describe, expect, it } from "vitest";
import { receiptForOrder, settlementForOrder } from "./receipt";

const order = { customerEmail: "buyer@example.test", total: 344.11, deliveryPrice: 44.11, items: [{ productName: "Чаша", quantity: 2, unitPrice: 150 }] };
describe("YooKassa receipt data", () => {
  it("includes products and paid delivery as full prepayment without VAT", () => {
    const receipt = receiptForOrder(order, "full_prepayment");
    expect(receipt.customer.email).toBe("buyer@example.test");
    expect(receipt.items).toMatchObject([{ quantity: 2, amount: { value: "150.00", currency: "RUB" }, vat_code: 1, payment_mode: "full_prepayment", payment_subject: "commodity" }, { amount: { value: "44.11" }, payment_subject: "service" }]);
  });
  it("forms a settlement linked to the same payment and paid total", () => {
    expect(settlementForOrder(order, "payment-id")).toMatchObject({ payment_id: "payment-id", send: true, settlements: [{ type: "prepayment", amount: { value: "344.11" } }], items: [{ payment_mode: "full_payment" }, { payment_mode: "full_payment" }] });
  });
  it("rejects a mismatch or unsupported receipt instead of charging the wrong amount", () => {
    expect(() => receiptForOrder({ ...order, total: 344.1 }, "full_prepayment")).toThrow("receipt-total");
    expect(() => receiptForOrder({ ...order, items: Array(81).fill(order.items[0]) }, "full_prepayment")).toThrow();
  });
});
