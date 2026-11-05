import type { TelegramConfig } from "./config";
import { telegramFetch } from "./transport";
export class TelegramError extends Error {
  constructor(readonly code: "credentials" | "recipient" | "rate" | "provider" | "uncertain" | "response", readonly retryable = false, readonly delay = 30000) { super(code); }
}
async function telegramApi(config: Pick<TelegramConfig, "token">, method: "getMe" | "getChat" | "sendMessage", body: unknown, transport: typeof fetch) {
  let response: Response;
  try {
    response = await transport(`https://api.telegram.org/bot${config.token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000) });
  } catch { throw method === "sendMessage" ? new TelegramError("uncertain") : new TelegramError("provider", method === "getChat"); }
  const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    if (!reader) throw new Error();
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 32000) { await reader.cancel(); throw new Error(); } chunks.push(part.value); }
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { ok?: boolean; result?: unknown; parameters?: { retry_after?: number } };
    if (response.status === 401) throw new TelegramError("credentials");
    if (response.status === 400 || response.status === 403) throw new TelegramError("recipient");
    if (response.status === 429) throw new TelegramError("rate", true, Math.min(3600000, Math.max(30000, Number(data.parameters?.retry_after || 30) * 1000)));
    if (!response.ok || data.ok !== true) throw new TelegramError("provider", response.status >= 500);
    return data.result;
  } catch (error) { if (error instanceof TelegramError) throw error; throw new TelegramError(method === "sendMessage" ? "uncertain" : "response"); }
}
export async function verifyTelegram(config: TelegramConfig, transport: typeof fetch = telegramFetch) {
  await telegramApi(config, "getMe", {}, transport);
  await telegramChatType(config, transport);
}
export async function telegramChatType(config: TelegramConfig, transport: typeof fetch = telegramFetch) {
  const chat = await telegramApi(config, "getChat", { chat_id: config.chatId }, transport) as { id?: number; type?: string } | null;
  if (!chat || String(chat.id) !== config.chatId || !["private", "group", "supergroup", "channel"].includes(chat.type ?? "")) throw new TelegramError("recipient");
  return chat.type;
}
export function telegramOrderText(orderId: string, baseUrl: string) {
  const base = new URL(baseUrl);
  if (base.origin !== "https://sidzen.shop" || base.port || base.username || base.password) throw new TelegramError("response");
  // No buyer names, contacts, address, comments, order number or product data.
  // The opaque internal reference opens an authenticated admin-only page.
  return `SIDZEN · новая заявка\nОткройте заказ в кабинете администратора:\n${base.origin}/admin/order-alert/${encodeURIComponent(orderId)}/`;
}
type OrderNotification = {
  id: string; number: string; shippingAddress: string | null; subtotal: { toString(): string };
  deliveryPrice: { toString(): string }; total: { toString(): string };
  shipment: { provider: string; cost: { toString(): string } } | null;
  items: Array<{ productName: string; quantity: number; totalPrice: { toString(): string } }>;
};
function cityFromAddress(address: string | null, provider: string | undefined) {
  if (!address || /^самовывоз/i.test(address.trim())) return null;
  const parts = address.split(",").map(part => part.trim()).filter(Boolean);
  const marked = parts.find(part => /^(?:г\.?|город|пос[её]лок|пгт\.?|село|деревня)\s+/i.test(part));
  const candidates = marked ? [marked.replace(/^(?:г\.?|город|пос[её]лок|пгт\.?|село|деревня)\s+/i, "")] :
    provider === "ozon-delivery" || provider === "cdek-delivery" ? (/^(?:ул\.?|улица|проспект|пр-т|переулок|пер\.?|шоссе|бульвар|набережная|площадь)\s/i.test(parts[1] ?? "") ? [parts[0]] : []) :
    [parts[/^\d{6}$/.test(parts[0] ?? "") ? 1 : 0]];
  const city = candidates[0] ?? "";
  if (parts.length < 2 || city.length > 80 || !/^[\p{L}\s.\-]+$/u.test(city) || /(?:^|\s)(?:ул|улица|проспект|пр|дом|д|область|край|район|республика|переулок|пер|бульвар|б-р|площадь|пл|шоссе|наб|набережная)(?:\.|\s|$)/iu.test(city)) return null;
  return city;
}
export function telegramPrivateOrderText(order: OrderNotification, baseUrl: string) {
  const link = telegramOrderText(order.id, baseUrl).split("\n").at(-1)!;
  const money = (value: { toString(): string }) => new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" }).format(Number(value.toString()));
  const city = cityFromAddress(order.shippingAddress, order.shipment?.provider);
  const items = order.items.slice(0, 25).map(item => `• ${item.productName.replace(/[\r\n\t]+/g, " ").slice(0, 100)} × ${item.quantity} — ${money(item.totalPrice)}`);
  if (order.items.length > items.length) items.push(`…и ещё ${order.items.length - items.length} позиций`);
  return [`SIDZEN · заказ ${order.number.replace(/[\r\n\t]+/g, " ").slice(0, 80)}`, "", ...items, "", `Город: ${city ?? "не указан"}`, `Товары: ${money(order.subtotal)}`, `Доставка для покупателя: ${money(order.deliveryPrice)}`, ...(order.shipment ? [`Расход на доставку: ${money(order.shipment.cost)}`] : []), `Итого: ${money(order.total)}`, "", link].join("\n");
}
export async function sendTelegram(config: TelegramConfig, text: string, transport: typeof fetch = telegramFetch) {
  await telegramApi(config, "sendMessage", { chat_id: config.chatId, text, link_preview_options: { is_disabled: true }, protect_content: true }, transport);
}
