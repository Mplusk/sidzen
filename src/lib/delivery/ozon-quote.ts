import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { checkoutRequestSchema, OzonDeliveryError, parcelSchema, type OzonCheckoutRequest } from "./ozon-client";
import { deliveryConfigFingerprint, type OzonDeliveryConfig } from "./ozon-config";

type DeliveryItem = { id: string; quantity: number; unitPrice: number; config: unknown; product: { name: string; madeToOrder: boolean; leadDays: number; shippingWeightG: number | null; shippingLengthMm: number | null; shippingWidthMm: number | null; shippingHeightMm: number | null } | null };
export function cartDeliveryFingerprint(cart: { id: string; items: DeliveryItem[] }) {
  return createHash("sha256").update(JSON.stringify([cart.id, cart.items.map(item => [item.id, item.quantity, item.unitPrice, item.config, item.product?.shippingWeightG, item.product?.shippingLengthMm, item.product?.shippingWidthMm, item.product?.shippingHeightMm, item.product?.leadDays, item.product?.madeToOrder])])).digest("hex");
}
export function buildOzonPostings(items: DeliveryItem[], config: OzonDeliveryConfig, now = Date.now()): OzonCheckoutRequest["postings"] {
  if (!config.shipmentMethodId) throw new OzonDeliveryError("method");
  const count = items.reduce((sum, item) => sum + item.quantity, 0);
  if (!count || count > 100) throw new OzonDeliveryError("parcels");
  const cutoff = new Date(now + Math.max(config.dispatchDays, ...items.map(item => item.product?.madeToOrder ? item.product.leadDays : 0)) * 86400000).toISOString();
  const postings: OzonCheckoutRequest["postings"] = [];
  for (const item of items) {
    const product = item.product;
    const dimensions = parcelSchema.safeParse({ weight_g: product?.shippingWeightG, length_mm: product?.shippingLengthMm, width_mm: product?.shippingWidthMm, height_mm: product?.shippingHeightMm });
    if (!dimensions.success || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.unitPrice <= 0) throw new OzonDeliveryError("packaging");
    // Each unit is a separately measured, packed parcel. Never guess combined box dimensions.
    for (let unit = 0; unit < item.quantity; unit++) postings.push({ request_id: postings.length + 1, shipment_method_id: config.shipmentMethodId, cutoff_at: cutoff, declared_value: { amount: item.unitPrice.toFixed(2), currency_code: "RUB" }, dimensions: dimensions.data });
  }
  return postings;
}
const quoteSchema = z.object({ request: checkoutRequestSchema, cart: z.string(), config: z.string(), address: z.string(), cost: z.number().finite().nonnegative(), days: z.number().int().nonnegative(), expires: z.number().int(), consentId: z.string().optional() });
export type OzonQuote = z.infer<typeof quoteSchema>;
export class OzonQuoteError extends OzonDeliveryError {
  constructor(public readonly reason: "expired" | "signature" | "cart" | "config" | "phone") { super("quote"); }
}
function signingKey() { if (!process.env.AUTH_SECRET) throw new Error("quote-key-missing"); return `${process.env.AUTH_SECRET}:ozon-delivery-quote-v1`; }
export function signOzonQuote(quote: OzonQuote) {
  const body = Buffer.from(JSON.stringify(quoteSchema.parse(quote))).toString("base64url");
  return `${body}.${createHmac("sha256", signingKey()).update(body).digest("base64url")}`;
}
export function verifyOzonQuote(token: string, cart: { id: string; items: DeliveryItem[] }, config: OzonDeliveryConfig, phone: string) {
  if (token.length > 100000) throw new OzonQuoteError("signature");
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra) throw new OzonQuoteError("signature");
  const expected = createHmac("sha256", signingKey()).update(body).digest(); const actual = Buffer.from(signature, "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new OzonQuoteError("signature");
  let quote: OzonQuote;
  try { quote = quoteSchema.parse(JSON.parse(Buffer.from(body, "base64url").toString())); } catch { throw new OzonQuoteError("signature"); }
  if (quote.expires <= Date.now()) throw new OzonQuoteError("expired");
  if (quote.cart !== cartDeliveryFingerprint(cart)) throw new OzonQuoteError("cart");
  if (quote.config !== deliveryConfigFingerprint(config)) throw new OzonQuoteError("config");
  if (quote.request.recipient.phone_number !== phone) throw new OzonQuoteError("phone");
  return quote;
}
