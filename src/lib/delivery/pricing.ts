// The shop pays the carrier. Keep carrier charges in Shipment.cost, never in
// Order.deliveryPrice or the buyer's payment amount.
export function customerDeliveryPrice() { return 0; }

export function deliveryTotals(subtotal: number, carrierCost: number) {
  if (!Number.isFinite(subtotal) || subtotal < 0 || !Number.isFinite(carrierCost) || carrierCost < 0) throw new Error("invalid-delivery-price");
  return { deliveryPrice: customerDeliveryPrice(), carrierCost, total: Math.round(subtotal * 100) / 100 };
}
