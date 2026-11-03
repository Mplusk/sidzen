import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { cartDeliveryFingerprint } from "@/lib/delivery/ozon-quote";
import type { CdekConfig } from "./cdek-config";
import type { CdekPackage } from "./cdek-client";

type Cart = Parameters<typeof cartDeliveryFingerprint>[0];
const packageSchema = z.object({ weight: z.number().int().positive(), length: z.number().int().positive(), width: z.number().int().positive(), height: z.number().int().positive() });
const quoteSchema = z.object({ point: z.string().min(1).max(80), address: z.string().min(1).max(500), cityCode: z.number().int().positive(), tariff: z.number().int().positive(), cost: z.number().finite().nonnegative().max(999999), daysMin: z.number().int().nonnegative(), daysMax: z.number().int().nonnegative(), cart: z.string(), config: z.string(), expires: z.number().int() });
export type CdekQuote = z.infer<typeof quoteSchema>;

export function cdekConfigFingerprint(config: CdekConfig) {
  return createHash("sha256").update(JSON.stringify([config.environment, config.clientId, config.senderCityCode, config.senderPoint, config.senderName, config.senderPhone])).digest("hex");
}

export function cdekPackages(cart: Cart): CdekPackage[] {
  const packages: CdekPackage[] = [];
  for (const item of cart.items) {
    const p = item.product;
    const parsed = packageSchema.safeParse({ weight: p?.shippingWeightG, length: p?.shippingLengthMm && Math.ceil(p.shippingLengthMm / 10), width: p?.shippingWidthMm && Math.ceil(p.shippingWidthMm / 10), height: p?.shippingHeightMm && Math.ceil(p.shippingHeightMm / 10) });
    if (!parsed.success || !Number.isSafeInteger(item.quantity) || item.quantity < 1) throw new Error("packaging");
    if (packages.length + item.quantity > 255) throw new Error("packages");
    for (let i = 0; i < item.quantity; i++) packages.push(parsed.data);
  }
  if (!packages.length) throw new Error("packages");
  return packages;
}

function key() {
  if (!process.env.AUTH_SECRET) throw new Error("quote-key-missing");
  return `${process.env.AUTH_SECRET}:cdek-delivery-quote-v1`;
}

export function signCdekQuote(quote: CdekQuote) {
  const body = Buffer.from(JSON.stringify(quoteSchema.parse(quote))).toString("base64url");
  return `${body}.${createHmac("sha256", key()).update(body).digest("base64url")}`;
}

export function verifyCdekQuote(token: string, cart: Cart, config: CdekConfig): CdekQuote {
  if (token.length > 100000) throw new Error("quote");
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra) throw new Error("quote");
  const expected = createHmac("sha256", key()).update(body).digest();
  const actual = Buffer.from(signature, "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error("quote");
  let quote: CdekQuote;
  try { quote = quoteSchema.parse(JSON.parse(Buffer.from(body, "base64url").toString())); } catch { throw new Error("quote"); }
  if (quote.expires <= Date.now() || quote.cart !== cartDeliveryFingerprint(cart) || quote.config !== cdekConfigFingerprint(config)) throw new Error("quote");
  return quote;
}
