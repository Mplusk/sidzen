/** Keep unavailable lines in the cart, but never send them to checkout or a carrier. */
export function checkoutCart<T extends { items: Array<{ available: boolean }> }>(cart: T | null) {
  if (!cart) return null;
  return { ...cart, items: cart.items.filter(item => item.available) as T["items"] };
}
