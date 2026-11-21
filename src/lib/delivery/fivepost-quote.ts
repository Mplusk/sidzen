import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { cartDeliveryFingerprint } from "./ozon-quote";
import { fivePostScope, type FivePostConfig } from "./fivepost-config";

type Cart = Parameters<typeof cartDeliveryFingerprint>[0];
const dimension = z.number().int().min(2).max(2_147_483_647);
export const fivePostParcelSchema = z.object({ length: dimension, width: dimension, height: dimension, weight: dimension });
const detailsSchema = z.object({ max: fivePostParcelSchema, base: z.number().positive(), extra: z.number().nonnegative().nullable(), days: z.number().int().nonnegative().nullable() });
const rate = z.object({ rateType: z.string(), rateTypeCode: z.string().nullish(), rateCode: z.string().nullish(), zone: z.union([z.string(), z.number()]).nullish(), rateCurrency: z.string(), rateValueWithVat: z.number(), rateExtraValueWithVat: z.number().nullish() });
const rawPoint = z.object({
  id: z.guid(), name: z.string().min(1), fullAddress: z.string().min(1), type: z.string(), extStatus: z.literal("ACTIVE"),
  address: z.object({ city: z.string().trim().min(1), region: z.string(), lat: z.number().min(-85).max(85), lng: z.number().min(-180).max(180) }),
  cellLimits: z.object({ maxCellLength: dimension, maxCellWidth: dimension, maxCellHeight: dimension, maxWeight: dimension }),
  rate: z.array(z.unknown()), deliverySL: z.array(z.unknown()).nullish(),
});
export function catalogPoint(value: unknown, config: FivePostConfig, generation: string) {
  const parsed = rawPoint.safeParse(value);
  if (!parsed.success) return null;
  const p = parsed.data;
  const rates = p.rate.map(item => rate.safeParse(item)).flatMap(item => item.success ? [item.data] : [])
    .filter(r => (r.rateType === config.rateType || r.rateTypeCode === config.rateType || r.rateCode === config.rateType) && r.rateCurrency === "RUB" && r.rateValueWithVat > 0 && r.zone != null && !/^(?:null|\s*)$/i.test(String(r.zone)));
  if (rates.length !== 1) return null;
  const label = p.address.city.replace(/\s+(?:г\.?|пгт\.?|п\.|с\.|д\.)$/iu, "").trim() || p.address.city;
  const term = z.object({ slCode: z.number(), sl: z.number().int().min(0).max(365) });
  const days = (p.deliverySL ?? []).map(s => term.safeParse(s)).find(s => s.success && s.data.slCode === config.slCode);
  const limits = p.cellLimits;
  return { generation, id: p.id, name: p.name, city: label, cityKey: label.toLocaleLowerCase("ru").replaceAll("ё", "е"), region: p.address.region, address: p.fullAddress, type: p.type, latitude: p.address.lat, longitude: p.address.lng,
    details: { max: { length: limits.maxCellLength, width: limits.maxCellWidth, height: limits.maxCellHeight, weight: limits.maxWeight },
      base: rates[0].rateValueWithVat, extra: rates[0].rateExtraValueWithVat ?? null, days: days?.success ? days.data.sl : null } };
}

// One physical parcel: lay each product's packed box flat and stack the layers.
// Both this fit check and the carrier order use the same dimensions and milligrams.
export function fivePostParcel(cart: Cart) {
  let length = 0, width = 0, height = 0, weight = 0;
  for (const { product, quantity } of cart.items) {
    if (!product || !Number.isSafeInteger(quantity) || quantity < 1) throw new Error("fivepost-packaging");
    const sides = [product.shippingLengthMm, product.shippingWidthMm, product.shippingHeightMm].map(side => dimension.parse(side)).sort((a, b) => b - a);
    length = Math.max(length, sides[0]);
    width = Math.max(width, sides[1]);
    height += sides[2] * quantity;
    weight += z.number().int().positive().parse(product.shippingWeightG) * 1000 * quantity;
  }
  return fivePostParcelSchema.parse({ length, width, height, weight });
}
export function pointPrice(point: { details: unknown }, cart: Cart, config: FivePostConfig) {
  const data = detailsSchema.parse(point.details);
  const parcel = fivePostParcel(cart);
  const sides = (box: typeof parcel) => [box.width, box.height, box.length].sort((a, b) => a - b);
  const max = sides(data.max);
  if (parcel.weight > data.max.weight || sides(parcel).some((size, index) => size > max[index])) throw new Error("fivepost-size");
  if (!config.baseKg) throw new Error("fivepost-tariff");
  const overweight = Math.max(0, Math.ceil(parcel.weight / 1_000_000) - config.baseKg);
  if (overweight && !data.extra) throw new Error("fivepost-tariff");
  const cost = Math.round((data.base + overweight * (data.extra ?? 0)) * 100) / 100;
  if (!Number.isFinite(cost) || cost <= 0 || cost > 999999) throw new Error("fivepost-tariff");
  return { parcel, cost, price: config.buyerPays ? cost : 0, days: data.days };
}
export type FivePostPointChoice = { id: string; city: string; address: string; details: unknown };
export function fivePostQuote(point: FivePostPointChoice, cart: Cart, config: FivePostConfig, expires = Date.now() + 15 * 60000) {
  const { cost, price, days, parcel } = pointPrice(point, cart, config);
  if (!process.env.AUTH_SECRET) throw new Error("quote-key-missing");
  const contents = [point.id, point.city, point.address, cost, price, days, cartDeliveryFingerprint(cart), fivePostScope(config), config.baseKg, config.buyerPays, expires];
  const mac = createHmac("sha256", process.env.AUTH_SECRET).update("fivepost-quote-v1:").update(JSON.stringify(contents)).digest("base64url");
  return { pointId: point.id, city: point.city, address: point.address, cost, price, days, parcel, token: [point.id, expires, mac].join(".") };
}
export function quoteIdentity(token: string) {
  const [id, deadline, mac, ...rest] = token.split(".");
  const expires = Number(deadline);
  if (rest.length || !z.guid().safeParse(id).success || !/^\d{13}$/.test(deadline) || !/^[\w-]{43}$/.test(mac) || expires <= Date.now() || expires > Date.now() + 15 * 60000) throw new Error("fivepost-quote");
  return { id, expires };
}
export function verifyFivePostQuote(token: string, point: FivePostPointChoice, cart: Cart, config: FivePostConfig) {
  const { id, expires } = quoteIdentity(token);
  const quote = fivePostQuote(point, cart, config, expires);
  if (id !== point.id || !timingSafeEqual(Buffer.from(token), Buffer.from(quote.token))) throw new Error("fivepost-quote");
  return quote;
}
