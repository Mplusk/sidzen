import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export const MONITORING_COOKIE = "sidzen_statistics";
export const MONITORING_VERSION = "2026-10-11-v1";
export const MONITORING_DAYS = 30;
export const MONITORING_LOCK = 73412040;
export const MONITORING_TEXT = "Добровольно разрешаю SIDZEN собирать статистику моих посещений: случайный идентификатор браузера, IP и приблизительную страну, тип устройства и браузера, источник перехода, переданную поисковиком фразу и запросы поиска в каталоге, просмотренные публичные страницы и активное время. При входе посещение может быть связано с моим профилем. Данные хранятся в России не более 30 дней, доступны только администраторам и не передаются внешним аналитическим сервисам. Содержимое форм заказа, входа и кабинета, а также закрытые страницы кабинета не записываются. Отказ не ограничивает покупки. Отозвать согласие и удалить статистику этого браузера можно на странице cookies.";
function sign(value: string) {
  if (!process.env.AUTH_SECRET) throw new Error("Statistics signing is not configured");
  return createHmac("sha256", process.env.AUTH_SECRET).update("sidzen-monitoring:" + value).digest("base64url");
}
export function monitoringConsent(now = Date.now()) {
  const payload = `${randomUUID()}.${now}.${MONITORING_VERSION}`;
  return `${payload}.${sign(payload)}`;
}
export function readMonitoringConsent(token: string | undefined, now = Date.now()) {
  try {
    if (!token || token.length > 250) return null;
    const [key, date, version, signature, extra] = token.split(".");
    const at = Number(date);
    if (extra || !/^[\da-f-]{36}$/.test(key) || version !== MONITORING_VERSION || !Number.isSafeInteger(at) || at > now || now - at >= MONITORING_DAYS * 86400000) return null;
    const expected = Buffer.from(sign(`${key}.${date}.${version}`)), actual = Buffer.from(signature ?? "");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    return { visitorHash: sign(key), at: new Date(at), version };
  } catch { return null; }
}
export function monitoringId(visitor: string, key: string) { return sign(visitor + ":" + key); }
export function trustedVisitorIp(headers: Headers) {
  // Caddy replaces this header, and the application port is not publicly exposed.
  // Never trust an arbitrary forwarded-for chain supplied by a visitor.
  const value = headers.get("x-sidzen-client-ip")?.trim().replace(/^::ffff:/i, "") ?? "";
  return isIP(value) ? value : null;
}
export function monitoringOriginAllowed(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (!origin || request.headers.get("sec-fetch-site") === "cross-site") return false;
    const canonical = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://sidzen.shop").origin;
    return origin === canonical || (process.env.NODE_ENV !== "production" && origin === new URL(request.url).origin);
  } catch { return false; }
}
export function publicMonitoringPath(value: string) {
  if (value.length > 240 || !/^\/(?:catalog(?:\/[\p{L}\p{N}_-]+){0,3}|about|contacts|faq|delivery|legal\/(?:privacy|cookies|offer|consent))\/?$/u.test(value)) return null;
  return value;
}
export function safeSearch(value: string | null | undefined) {
  if (!value || value.length > 120 || /[@/:\\]|\d{7}|\b(?:token|password|secret|email)\b/i.test(value)) return null;
  return value.replace(/[^\p{L}\p{N}\s.,!?()'"+-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 120) || null;
}
export function monitoringSource(referrer: string | undefined, campaign: string | undefined) {
  let source: string | null = null, searchPhrase: string | null = null;
  try {
    const url = new URL(referrer ?? "");
    const own = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://sidzen.shop");
    if (["https:", "http:"].includes(url.protocol) && url.hostname !== own.hostname) {
      source = url.hostname.slice(0, 160);
      if (/^(?:www\.)?(?:google\.[a-z.]+|yandex\.(?:ru|com)|ya\.ru|bing\.com|search\.yahoo\.com|duckduckgo\.com)$/.test(url.hostname)) searchPhrase = safeSearch(url.searchParams.get("q") ?? url.searchParams.get("text") ?? url.searchParams.get("p"));
    }
  } catch { /* A missing referrer is not evidence of a particular source. */ }
  return { source, searchPhrase, campaign: campaign && /^[\p{L}\p{N}_. -]{1,80}$/u.test(campaign) && !/\d{7}/.test(campaign) ? campaign : null };
}
export function monitoringAgent(value: string) {
  return { browser: /Edg\//.test(value) ? "Edge" : /Firefox\//.test(value) ? "Firefox" : /(?:Chrome|CriOS)\//.test(value) ? "Chrome" : /Safari\//.test(value) ? "Safari" : "Другой", device: /iPad|Tablet/i.test(value) ? "Планшет" : /Mobile|Android|iPhone/i.test(value) ? "Телефон" : "Компьютер", bot: /bot|crawler|spider|headless/i.test(value) };
}
