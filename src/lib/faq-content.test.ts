import { describe, expect, it } from "vitest";
import { faqItems } from "./faq-content";

describe("customer FAQ", () => {
  it("describes YooKassa and shipment timing when online payment is enabled", () => {
    const answer = Object.fromEntries(faqItems(true))["Как оформить заказ?"];
    expect(answer).toContain("ЮKassa");
    expect(answer).toContain("после подтверждения оплаты");
    expect(answer).not.toContain("ничего не списывает");
  });

  it("describes a request without online payment when checkout is in request mode", () => {
    const answer = Object.fromEntries(faqItems(false))["Как оформить заказ?"];
    expect(answer).toContain("ничего не списывает");
    expect(answer).not.toContain("ЮKassa");
  });
});

