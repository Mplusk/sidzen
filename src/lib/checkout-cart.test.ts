import { describe, expect, it } from "vitest";
import { checkoutCart } from "./checkout-cart";

describe("checkout cart", () => {
  it("keeps unavailable rows out of delivery and order calculations without mutating the cart", () => {
    const cart = { id: "cart", items: [{ id: "in-stock", available: true }, { id: "sold-out", available: false }] };
    expect(checkoutCart(cart)).toEqual({ id: "cart", items: [{ id: "in-stock", available: true }] });
    expect(cart.items).toHaveLength(2);
    expect(checkoutCart(null)).toBeNull();
  });
});
