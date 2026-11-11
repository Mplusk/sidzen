import type { TelegramConfig } from "./config";
import { telegramFetch } from "./transport";
import { destinationCity } from "@/lib/delivery/destination-city";
import { configurationText } from "@/lib/product-options";
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
  items: Array<{ productName: string; quantity: number; totalPrice: { toString(): string }; configuration?: unknown; groupLabel?: string | null; product?: { groupId: string | null; groupLabel: string | null } | null; color?: { name: string } | null }>;
};
const clean = (value: string, limit: number) => value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, limit);
function itemText(item: OrderNotification["items"][number], money: (value: { toString(): string }) => string) {
  const config = item.configuration && typeof item.configuration === "object" && !Array.isArray(item.configuration) ? item.configuration as Record<string, unknown> : {};
  const color = clean(configurationText({ colorName: config.colorName || item.color?.name, color: config.color }), 60);
  const group = clean(item.groupLabel || (item.product?.groupId ? item.product.groupLabel : "") || "", 80);
  const sameColor = color && color.toLocaleLowerCase("ru-RU") === group.toLocaleLowerCase("ru-RU");
  const details = [group && !sameColor ? `Вариант: ${group}` : "", color ? `Цвет: ${color}` : ""].filter(Boolean);
  return `• ${clean(item.productName, 100)}${details.length ? ` · ${details.join(" · ")}` : ""} × ${item.quantity} — ${money(item.totalPrice)}`;
}
export function telegramPrivateOrderText(order: OrderNotification, baseUrl: string) {
  const link = telegramOrderText(order.id, baseUrl).split("\n").at(-1)!;
  const money = (value: { toString(): string }) => new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" }).format(Number(value.toString()));
  const city = destinationCity(order.shippingAddress, order.shipment?.provider);
  const items: string[] = [];
  for (const item of order.items.slice(0, 25)) {
    const line = itemText(item, money);
    if (items.join("\n").length + line.length > 2800) break;
    items.push(line);
  }
  if (order.items.length > items.length) items.push(`…и ещё ${order.items.length - items.length} позиций`);
  return [`SIDZEN · заказ ${clean(order.number, 80)}`, "", ...items, "", `Город: ${city ?? "не указан"}`, `Товары: ${money(order.subtotal)}`, `Доставка для покупателя: ${money(order.deliveryPrice)}`, ...(order.shipment ? [`Расход на доставку: ${money(order.shipment.cost)}`] : []), `Итого: ${money(order.total)}`, "", link].join("\n");
}

export function telegramOrderStatusText(order: { id: string; number: string; reservationExpiredAt: Date | null; stockReviewRequired: boolean }, kind: "CANCELED" | "LATE_PAYMENT", baseUrl: string, privateChat: boolean) {
  const link = telegramOrderText(order.id, baseUrl).split("\n").at(-1)!;
  if (!privateChat) return `SIDZEN · ${kind === "CANCELED" ? "заказ отменён" : "статус заказа изменился"}\n${link}`;
  const number = clean(order.number, 80);
  if (kind === "CANCELED") return [`SIDZEN · заказ ${number} отменён`, ...(order.reservationExpiredAt ? ["Причина: истекло время оплаты."] : []), "", link].join("\n");
  return [`SIDZEN · оплата заказа ${number} подтверждена после отмены`, ...(order.stockReviewRequired ? ["Требуется проверить наличие товара."] : []), "", link].join("\n");
}
export async function sendTelegram(config: TelegramConfig, text: string, transport: typeof fetch = telegramFetch) {
  await telegramApi(config, "sendMessage", { chat_id: config.chatId, text, link_preview_options: { is_disabled: true }, protect_content: true }, transport);
}
