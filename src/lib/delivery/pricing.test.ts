import { describe, expect, it } from "vitest";
import { customerDeliveryPrice, deliveryTotals } from "./pricing";

describe("free customer delivery with separate carrier expenses", () => {
  it.each([0, 99, 390, 490, 1234.56])("never adds carrier cost %s to the buyer total", cost => {
    expect(customerDeliveryPrice()).toBe(0);
    expect(deliveryTotals(240, cost)).toEqual({ deliveryPrice: 0, carrierCost: cost, total: 240 });
  });
  it("rounds goods total without changing the carrier quote", () => {
    expect(deliveryTotals(120.345, 123.45)).toEqual({ deliveryPrice: 0, carrierCost: 123.45, total: 120.35 });
  });
  it.each([NaN, Infinity, -1])("rejects invalid totals and carrier quotes (%s)", value => {
    expect(() => deliveryTotals(value, 10)).toThrow("invalid-delivery-price");
    expect(() => deliveryTotals(240, value)).toThrow("invalid-delivery-price");
  });
});
