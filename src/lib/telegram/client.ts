import type { TelegramConfig } from "./config";
export class TelegramError extends Error {
  constructor(readonly code: "credentials" | "recipient" | "rate" | "provider" | "uncertain" | "response", readonly retryable = false, readonly delay = 30000) { super(code); }
}
async function telegramApi(config: Pick<TelegramConfig, "token">, method: "getMe" | "getChat" | "sendMessage", body: unknown, transport: typeof fetch) {
  let response: Response;
  try {
    response = await transport(`https://api.telegram.org/bot${config.token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000) });
  } catch { throw new TelegramError(method === "sendMessage" ? "uncertain" : "provider"); }
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
export async function verifyTelegram(config: TelegramConfig, transport: typeof fetch = fetch) {
  await telegramApi(config, "getMe", {}, transport);
  const chat = await telegramApi(config, "getChat", { chat_id: config.chatId }, transport) as { id?: number; type?: string } | null;
  if (!chat || String(chat.id) !== config.chatId || !["private", "group", "supergroup", "channel"].includes(chat.type ?? "")) throw new TelegramError("recipient");
}
export function telegramOrderText(orderId: string, baseUrl: string) {
  const base = new URL(baseUrl);
  if (base.protocol !== "https:" || !["sidzen.shop", "3dprinta.shop"].includes(base.hostname) || base.port || base.username || base.password) throw new TelegramError("response");
  // No buyer names, contacts, address, comments, order number or product data.
  // The opaque internal reference opens an authenticated admin-only page.
  return `SIDZEN · новая заявка\nОткройте заказ в кабинете администратора:\n${base.origin}/admin/order-alert/${encodeURIComponent(orderId)}/`;
}
export async function sendTelegram(config: TelegramConfig, text: string, transport: typeof fetch = fetch) {
  await telegramApi(config, "sendMessage", { chat_id: config.chatId, text, link_preview_options: { is_disabled: true }, protect_content: true }, transport);
}
