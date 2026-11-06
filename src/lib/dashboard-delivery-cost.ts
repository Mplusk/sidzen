type Amount = number | string | { toString(): string };

const percent = new Intl.NumberFormat("ru-RU", {
  style: "percent",
  maximumFractionDigits: 1,
});

/** The stored carrier quote divided by the goods subtotal, without customer delivery charges. */
export function dashboardDeliveryCost(cost: Amount | null | undefined, subtotal: Amount) {
  if (cost == null) return null;
  const amount = Number(cost);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const goods = Number(subtotal);
  const ratio = amount / goods;
  const share = Number.isFinite(goods) && goods > 0 && Number.isFinite(ratio)
    ? ratio > 0 && ratio < 0.001 ? "<0,1 %" : percent.format(ratio)
    : null;
  return { amount, share };
}
