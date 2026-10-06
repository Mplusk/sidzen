import { z } from "zod";
import { snapshotSchema, type Connection, type Provider, type Snapshot } from "./model";
import { ozonAttributesSchema, ozonAttributeDictionarySchema, ozonSpecifications, type OzonAttributeCache } from "./ozon-attributes";
import { ozonMeasurements } from "./ozon-measurements";

export class MarketplaceError extends Error {}
const id = z.union([z.number().int().positive().safe(), z.string().regex(/^\d+$/)]).transform(String);
const nullableString = z.string().nullish();
const wbCardSchema = z.object({
  nmID: id, imtID: id.optional(), vendorCode: z.string(), title: z.string(), description: nullableString,
  photos: z.array(z.object({ big: z.string() })).default([]),
  sizes: z.array(z.object({ skus: z.array(z.string()).default([]) })).default([]),
  characteristics: z.array(z.object({ name: z.string(), value: z.union([z.array(z.union([z.string(), z.number()])), z.string(), z.number()]) })).default([]),
});
const wbPageSchema = z.object({ cards: z.array(wbCardSchema), cursor: z.object({ updatedAt: z.string().optional(), nmID: z.number().optional(), total: z.number().int().nonnegative() }) });
const wbPricesSchema = z.object({ error: z.boolean().optional(), data: z.object({ listGoods: z.array(z.object({
  nmID: id, currencyIsoCode4217: z.string(), sizes: z.array(z.object({ price: z.number(), discountedPrice: z.number() })),
})) }) });
const ozonListSchema = z.object({ result: z.object({ items: z.array(z.object({ product_id: id, offer_id: z.string() })), last_id: z.string(), total: z.number().int().nonnegative() }) });
const ozonInfoSchema = z.object({ items: z.array(z.object({
  id, offer_id: z.string(), name: z.string(), barcodes: z.array(z.string()).default([]),
  images: z.array(z.string()).default([]), primary_image: z.union([z.string(), z.array(z.string())]).nullish(),
})) });
const ozonPricesSchema = z.object({ items: z.array(z.object({ product_id: id, price: z.object({
  price: z.union([z.string(), z.number()]), old_price: z.union([z.string(), z.number()]).nullish(), currency_code: z.string(),
}) })) });
export type Page = { items: Snapshot[]; cursor: Record<string, string | number>; done: boolean };
export type Transport = typeof fetch;
type WbPrice = z.infer<typeof wbPricesSchema>["data"]["listGoods"][number];

export async function boundedBytes(response: Response, maximum: number) {
  if (Number(response.headers.get("content-length")) > maximum) throw new MarketplaceError("format");
  const reader = response.body?.getReader();
  if (!reader) throw new MarketplaceError("format");
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximum) throw new MarketplaceError("format");
      parts.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  return Buffer.concat(parts);
}

export async function apiJson(url: string, connection: Connection, method: "GET" | "POST", body?: unknown, transport: Transport = fetch) {
  // Endpoints are constants supplied by the adapters, never administrator URLs.
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const endpoint = new URL(url);
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.port || !["api-seller.ozon.ru", "content-api.wildberries.ru", "discounts-prices-api.wildberries.ru", "common-api.wildberries.ru"].includes(endpoint.hostname)) throw new MarketplaceError("format");
  if (new URL(url).hostname === "api-seller.ozon.ru") {
    headers["Client-Id"] = connection.clientId; headers["Api-Key"] = connection.secret;
  } else headers.Authorization = connection.secret;
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try { response = await transport(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "error", cache: "no-store", signal: AbortSignal.timeout(20_000) }); }
    catch { throw new MarketplaceError("remote"); }
    if (response.status === 401 || response.status === 403) { await response.body?.cancel(); throw new MarketplaceError("auth"); }
    if (response.status === 429) {
      await response.body?.cancel();
      if (attempt === 2) throw new MarketplaceError("rate");
      const seconds = Math.min(15, Math.max(1, Number(response.headers.get("retry-after")) || (attempt + 1) * 3));
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
      continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new MarketplaceError("remote"); }
    try { return JSON.parse((await boundedBytes(response, 20 * 1024 * 1024)).toString("utf8")) as unknown; }
    catch { throw new MarketplaceError("format"); }
  }
  throw new MarketplaceError("rate");
}

export async function fetchWbPrices(connection: Connection, transport: Transport = fetch) {
  const prices = new Map<string, WbPrice>();
  // GET the full price list rather than the paid POST-by-articles method.
  for (let offset = 0; offset <= 100_000; offset += 1000) {
    const page = wbPricesSchema.parse(await apiJson(`https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter?limit=1000&offset=${offset}`, connection, "GET", undefined, transport));
    if (page.error) throw new MarketplaceError("format");
    if (!page.data.listGoods.length) return prices;
    for (const price of page.data.listGoods) prices.set(price.nmID, price);
    if (prices.size > 100_000) throw new MarketplaceError("format");
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  throw new MarketplaceError("format");
}

function plainText(text: string) {
  return text.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim().slice(0, 20_000);
}
function checkedSnapshot(value: Snapshot): Snapshot {
  if (value.specifications) {
    const compact: Record<string, string> = {};
    for (const [key, item] of Object.entries(value.specifications)) {
      const next = { ...compact, [key.slice(0, 180)]: item.slice(0, 1000) };
      // Keep generated JSON editable within the existing administrator form limit.
      if (JSON.stringify(next, null, 2).length > 28_000) break;
      Object.assign(compact, next);
    }
    value.specifications = compact;
  }
  const parsed = snapshotSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  // Keep an inspectable, non-importable listing rather than skipping a bad item.
  return { ...value, name: value.name.trim().slice(0, 180) || "Без названия", sku: value.sku.trim().slice(0, 80) || `ID-${value.externalId}`, price: 1, oldPrice: null, issue: "data" };
}

export async function fetchOzonAttributes(connection: Connection, ids: string[], transport: Transport = fetch, cache: OzonAttributeCache = new Map()) {
  const attributes = ozonAttributesSchema.parse(await apiJson("https://api-seller.ozon.ru/v4/product/info/attributes", connection, "POST", { filter: { product_id: ids, visibility: "ALL" }, limit: 100, sort_dir: "ASC" }, transport));
  const result = new Map<string, { item: typeof attributes.result[number]; labels: Map<number, string> }>();
  for (const item of attributes.result) {
    let labels = new Map(item.attributes.filter(attribute => attribute.name?.trim()).map(attribute => [attribute.id, attribute.name!.trim()]));
    if (item.attributes.some(attribute => attribute.id !== 4191 && !labels.has(attribute.id))) {
      if (!item.description_category_id || !item.type_id) throw new MarketplaceError("format");
      const key = `${item.description_category_id}:${item.type_id}`;
      const saved = cache.get(key);
      if (saved) labels = saved;
      else {
        const dictionary = ozonAttributeDictionarySchema.parse(await apiJson("https://api-seller.ozon.ru/v1/description-category/attribute", connection, "POST", { description_category_id: item.description_category_id, type_id: item.type_id, language: "DEFAULT" }, transport));
        labels = new Map(dictionary.result.map(attribute => [attribute.id, attribute.name]));
        if (cache.size >= 500) cache.clear();
        cache.set(key, labels);
      }
    }
    result.set(item.id, { item, labels });
  }
  return result;
}

export async function fetchPage(provider: Provider, connection: Connection, cursor: Record<string, unknown>, transport: Transport = fetch, wbPrices?: Map<string, WbPrice>, ozonAttributeCache?: OzonAttributeCache): Promise<Page> {
  try {
    if (provider === "wb") {
      const paging = { limit: 20, ...(cursor.updatedAt && cursor.nmID ? { updatedAt: cursor.updatedAt, nmID: cursor.nmID } : {}) };
      const page = wbPageSchema.parse(await apiJson("https://content-api.wildberries.ru/content/v2/get/cards/list", connection, "POST", { settings: { sort: { ascending: true }, cursor: paging, filter: { withPhoto: -1 } } }, transport));
      if (!page.cards.length) return { items: [], cursor: {}, done: true };
      const prices = wbPrices ?? await fetchWbPrices(connection, transport);
      const done = page.cursor.total < 20;
      if (!done && (!page.cursor.updatedAt || !page.cursor.nmID || (page.cursor.updatedAt === cursor.updatedAt && page.cursor.nmID === cursor.nmID))) throw new MarketplaceError("format");
      return { done, cursor: { updatedAt: page.cursor.updatedAt ?? "", nmID: page.cursor.nmID ?? 0 }, items: page.cards.map((card) => {
        const price = prices.get(card.nmID);
        const size = price?.sizes[0];
        const priceValues = new Set(price?.sizes.map((value) => value.discountedPrice));
        return checkedSnapshot({ externalId: card.nmID, sku: card.vendorCode, name: card.title.trim().slice(0, 180), barcodes: [...new Set(card.sizes.flatMap((value) => value.skus))],
          description: plainText(card.description ?? "") || null,
          specifications: Object.fromEntries(card.characteristics.map((item) => [item.name, Array.isArray(item.value) ? item.value.join(", ") : String(item.value)])),
          price: size?.discountedPrice ?? 1, oldPrice: size && size.price > size.discountedPrice ? size.price : null,
          images: [...new Set(card.photos.map((photo) => photo.big))].slice(0, 20),
          ...(card.imtID ? { group: { id: card.imtID, label: card.characteristics.filter(item => /^цвет(?:\s|$)/i.test(item.name.trim())).map(item => Array.isArray(item.value) ? item.value.join(", ") : String(item.value)).join(", ").slice(0, 180) } } : {}),
          issue: !size || price?.currencyIsoCode4217 !== "RUB" ? "currency" : priceValues.size > 1 ? "prices" : null,
        });
      }) };
    }
    const page = ozonListSchema.parse(await apiJson("https://api-seller.ozon.ru/v3/product/list", connection, "POST", { filter: { visibility: "ALL" }, last_id: cursor.last_id ?? "", limit: 20 }, transport)).result;
    if (!page.items.length) return { items: [], cursor: {}, done: true };
    const ids = page.items.map((item) => item.product_id);
    const info = ozonInfoSchema.parse(await apiJson("https://api-seller.ozon.ru/v3/product/info/list", connection, "POST", { product_id: ids }, transport));
    const priceInfo = ozonPricesSchema.parse(await apiJson("https://api-seller.ozon.ru/v5/product/info/prices", connection, "POST", { filter: { product_id: ids, visibility: "ALL" }, limit: 100 }, transport));
    const byAttributes = await fetchOzonAttributes(connection, ids, transport, ozonAttributeCache);
    const byId = new Map(info.items.map((item) => [item.id, item]));
    const byPrices = new Map(priceInfo.items.map((item) => [item.product_id, item.price]));
    const done = page.items.length < 20;
    if (!done && (!page.last_id || page.last_id === cursor.last_id)) throw new MarketplaceError("format");
    return { done, cursor: { last_id: page.last_id }, items: page.items.map((listed) => {
      const item = byId.get(listed.product_id);
      const attr = byAttributes.get(listed.product_id);
      const priceData = byPrices.get(listed.product_id);
      if (!item || !attr || !priceData || item.offer_id !== listed.offer_id) throw new MarketplaceError("format");
      const primary = Array.isArray(item.primary_image) ? item.primary_image : item.primary_image ? [item.primary_image] : [];
      const price = Number(priceData.price), oldPrice = Number(priceData.old_price);
      return checkedSnapshot({ externalId: item.id, sku: item.offer_id, name: item.name.trim().slice(0, 180), barcodes: [...new Set(item.barcodes)],
        description: plainText(attr.item.attributes.find((attribute) => attribute.id === 4191)?.values.map((value) => value.value).join("\n") ?? "") || null,
        specifications: ozonSpecifications(attr.item, attr.labels),
        measurements: ozonMeasurements(attr.item, attr.labels),
        price, oldPrice: oldPrice > price ? oldPrice : null, images: [...new Set([...primary, ...item.images])].slice(0, 20), issue: priceData.currency_code !== "RUB" ? "currency" : null,
      });
    }) };
  } catch (error) { if (error instanceof MarketplaceError) throw error; throw new MarketplaceError("format"); }
}

export async function checkConnection(provider: Provider, connection: Connection) {
  if (provider === "ozon") {
    ozonListSchema.parse(await apiJson("https://api-seller.ozon.ru/v3/product/list", connection, "POST", { filter: { visibility: "ALL" }, last_id: "", limit: 1 }));
    return { accountId: connection.clientId, name: `Ozon · ${connection.clientId}` };
  }
  const seller = z.object({ sid: z.string().min(1).max(100), name: z.string().max(200) }).parse(await apiJson("https://common-api.wildberries.ru/api/v1/seller-info", connection, "GET"));
  wbPageSchema.parse(await apiJson("https://content-api.wildberries.ru/content/v2/get/cards/list", connection, "POST", { settings: { cursor: { limit: 1 }, filter: { withPhoto: -1 } } }));
  wbPricesSchema.parse(await apiJson("https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter?limit=1&offset=0", connection, "GET"));
  return { accountId: seller.sid, name: seller.name };
}
