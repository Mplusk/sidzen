export const MONITORING_DAYS = 30;
export const MONITORING_LOCK = 73412040;
export const LEGACY_MONITORING_COOKIE = "sidzen_statistics";
const staticPages = new Set(["/", "/catalog/", "/about/", "/contacts/", "/faq/", "/delivery/", "/legal/privacy/", "/legal/cookies/", "/legal/offer/", "/legal/consent/"]);

// Calendar dates in Moscow, stored as DATE, not event timestamps.
export function monitoringDay(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (name: string) => parts.find(item => item.type === name)!.value;
  return new Date(`${part("year")}-${part("month")}-${part("day")}T00:00:00.000Z`);
}
export function monitoringCutoff(days: number, now = new Date()) { return new Date(monitoringDay(now).getTime() - (days - 1) * 86400000); }
export function publicMonitoringPath(value: string) {
  if (value === "/") return "/";
  if (value.length > 720 || /%2f|%5c/i.test(value)) return null;
  try { value = decodeURIComponent(value); } catch { return null; }
  if (value.length > 240 || !/^\/(?:catalog(?:\/[\p{L}\p{N}_-]+){0,2}|about|contacts|faq|delivery|legal\/(?:privacy|cookies|offer|consent))\/?$/u.test(value)) return null;
  return value.endsWith("/") ? value : `${value}/`;
}
export function isStaticMonitoringPath(path: string) { return staticPages.has(path); }
export function monitoringOriginAllowed(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (!origin || request.headers.get("sec-fetch-site") === "cross-site") return false;
    return origin === new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://sidzen.shop").origin || origin === new URL(request.url).origin;
  } catch { return false; }
}
