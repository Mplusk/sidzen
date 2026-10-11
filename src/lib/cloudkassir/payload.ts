import { z } from "zod";

export const fiscalPayloadSchema = z.object({ Inn: z.string(), Type: z.enum(["Income", "IncomeReturn"]), InvoiceId: z.string(), CustomerReceipt: z.object({
  Items: z.array(z.object({ Label: z.string().min(1).max(128), Price: z.number().positive(), Quantity: z.number().int().positive(), Amount: z.number().positive(), Vat: z.null(), Method: z.union([z.literal(1), z.literal(4)]), Object: z.union([z.literal(1), z.literal(4)]), UnitCode: z.literal(0) })).min(1).max(100),
  TaxationSystem: z.literal(1), Amounts: z.object({ Electronic: z.number().nonnegative(), AdvancePayment: z.number().nonnegative(), Credit: z.literal(0), Provision: z.literal(0) }),
  Email: z.email(), CalculationPlace: z.literal("https://sidzen.shop"), IsInternetPayment: z.literal(true),
}) });
export type FiscalPayload = z.infer<typeof fiscalPayloadSchema>;
type Money = string | number | { toString(): string };
type FiscalOrder = { total: Money; subtotal: Money; discount: Money; deliveryPrice: Money; currency: string; customerEmail: string; items: { productName: string; quantity: number; unitPrice: Money; totalPrice: Money }[] };
export function cents(value: Money) {
  const text = String(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error("fiscal-money");
  const result = Math.round(Number(text) * 100);
  if (!Number.isSafeInteger(result)) throw new Error("fiscal-money");
  return result;
}
export function createFiscalPayload(order: FiscalOrder, inn: string, invoiceId: string): FiscalPayload {
  if (order.currency !== "RUB") throw new Error("fiscal-currency");
  const total = cents(order.total), delivery = cents(order.deliveryPrice), discount = cents(order.discount);
  const bases = order.items.map(item => {
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0 || !item.productName.trim()) throw new Error("fiscal-item");
    const base = cents(item.totalPrice);
    if (base !== cents(item.unitPrice) * item.quantity) throw new Error("fiscal-item-total");
    return base;
  });
  const subtotal = bases.reduce((a, b) => a + b, 0);
  if (!subtotal || subtotal !== cents(order.subtotal) || discount >= subtotal || subtotal - discount + delivery !== total) throw new Error("fiscal-total");
  // Largest-remainder discount allocation in integer kopecks; split a quantity
  // into at most two lines so Price × Quantity always equals Amount exactly.
  const shares = bases.map(base => Number(BigInt(discount) * BigInt(base) / BigInt(subtotal)));
  const sorted = bases.map((base, i) => ({ i, remainder: BigInt(discount) * BigInt(base) % BigInt(subtotal) })).sort((a, b) => a.remainder === b.remainder ? a.i - b.i : a.remainder > b.remainder ? -1 : 1);
  const remainder = discount - shares.reduce((a, b) => a + b, 0);
  for (let i = 0; i < remainder; i++) shares[sorted[i].i]++;
  const Items: FiscalPayload["CustomerReceipt"]["Items"] = [];
  order.items.forEach((item, i) => {
    const amount = bases[i] - shares[i], price = Math.floor(amount / item.quantity), extra = amount % item.quantity;
    if (!price) throw new Error("fiscal-zero-price");
    for (const [unit, quantity] of [[price, item.quantity - extra], [price + 1, extra]]) if (quantity) Items.push({ Label: item.productName.trim().slice(0, 128), Price: unit / 100, Quantity: quantity, Amount: unit * quantity / 100, Vat: null, Method: 1, Object: 1, UnitCode: 0 });
  });
  if (delivery) Items.push({ Label: "Доставка", Price: delivery / 100, Quantity: 1, Amount: delivery / 100, Vat: null, Method: 1, Object: 4, UnitCode: 0 });
  return fiscalPayloadSchema.parse({ Inn: inn, Type: "Income", InvoiceId: invoiceId, CustomerReceipt: { Items, TaxationSystem: 1, Email: order.customerEmail, CalculationPlace: "https://sidzen.shop", IsInternetPayment: true, Amounts: { Electronic: total / 100, AdvancePayment: 0, Credit: 0, Provision: 0 } } });
}
export function derivedFiscalPayload(original: FiscalPayload, kind: "SETTLEMENT" | "REFUND", invoiceId: string, delivered: boolean) {
  const payload = structuredClone(original);
  payload.InvoiceId = invoiceId;
  if (kind === "SETTLEMENT") {
    payload.CustomerReceipt.Items.forEach(item => { item.Method = 4; });
    const total = payload.CustomerReceipt.Amounts.Electronic;
    payload.CustomerReceipt.Amounts = { Electronic: 0, AdvancePayment: total, Credit: 0, Provision: 0 };
  } else {
    payload.Type = "IncomeReturn";
    payload.CustomerReceipt.Items.forEach(item => { item.Method = delivered ? 4 : 1; });
  }
  return fiscalPayloadSchema.parse(payload);
}

// Receipt callbacks/detail responses add nullable provider fields and may use
// camelCase. Compare the fiscal composition, not JSON field order or extras.
export function receiptMatches(incoming: unknown, expected: FiscalPayload["CustomerReceipt"]) {
  const lower = (value: unknown): unknown => Array.isArray(value) ? value.map(lower) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key.toLowerCase(), lower(item)])) : value;
  const item = z.object({ label: z.string(), price: z.number(), quantity: z.number(), amount: z.number(), vat: z.null().optional(), method: z.number(), object: z.number() });
  const parsed = z.object({ items: z.array(item), taxationsystem: z.number(), amounts: z.object({ electronic: z.number(), advancepayment: z.number().nullish(), credit: z.number().nullish(), provision: z.number().nullish(), cash: z.number().nullish() }), email: z.string().nullish() }).safeParse(lower(incoming));
  if (!parsed.success) return false;
  const data = parsed.data;
  const want = expected.Items;
  return data.taxationsystem === 1 && (!data.email || data.email.toLowerCase() === expected.Email.toLowerCase()) && data.items.length === want.length && data.items.every((row, i) => row.label === want[i].Label && row.quantity === want[i].Quantity && row.method === want[i].Method && row.object === want[i].Object && row.price === want[i].Price && row.amount === want[i].Amount) && data.amounts.electronic === expected.Amounts.Electronic && (data.amounts.advancepayment ?? 0) === expected.Amounts.AdvancePayment && !(data.amounts.credit || data.amounts.provision || data.amounts.cash);
}
