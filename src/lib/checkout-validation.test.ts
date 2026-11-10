import { describe, expect, it } from "vitest";
import { checkoutSchema, normalizePhone } from "./checkout-validation";
const input = { name: "Тест", email: "QA@EXAMPLE.TEST", phone: "+7 (999) 123-45-67", city: "Москва", address: "Тестовая, 1", postalCode: "123456", delivery: "cdek", comment: "", legal: "on", payment: "manual", expectedTotal: "2490.00" };
describe("checkout validation", () => {
  it("normalizes phone, email and total", () => { expect(checkoutSchema.parse(input)).toMatchObject({ phone: "+79991234567", email: "qa@example.test", expectedTotal: 2490 }); expect(normalizePhone("8 999 1234567")).toBe("+79991234567"); });
  it("requires no payment option and strips payment values in stale or forged forms", () => { expect(checkoutSchema.safeParse({ ...input, payment: undefined }).success).toBe(true); for (const payment of ["tochka", "yookassa", "manual", "cash"]) expect(checkoutSchema.parse({ ...input, payment })).not.toHaveProperty("payment"); });
  it("requires actual contacts, consent and positive finite total", () => { for (const bad of [{ phone: "123" }, { email: "wrong" }, { name: " " }, { legal: "" }, { expectedTotal: "-1" }, { expectedTotal: "Infinity" }]) expect(checkoutSchema.safeParse({ ...input, ...bad }).success).toBe(false); });
  it("validates delivery addresses but allows pickup without one", () => {
    expect(checkoutSchema.safeParse({ ...input, city: "", address: "" }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...input, delivery: "pickup", city: "", address: "", postalCode: "" }).success).toBe(true);
    expect(checkoutSchema.safeParse({ ...input, delivery: "russian-post", postalCode: "" }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...input, postalCode: "12345x" }).success).toBe(false);
  });
  it("accepts an Ozon order without a separate checkbox while requiring a verified quote and mobile phone", () => {
    const order = { ...input, delivery: "ozon-delivery", city: "", address: "", ozonQuote: "signed-quote" };
    expect(checkoutSchema.safeParse(order).success).toBe(true);
    expect(checkoutSchema.safeParse({ ...order, ozonQuote: "" }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...order, phone: "+7 (000) 000-00-00" }).success).toBe(false);
    expect(checkoutSchema.safeParse({ ...order, legal: "" }).success).toBe(false);
  });
});
