import { publicMonitoringPath } from "@/lib/monitoring-policy";

export const METRIKA_ID = 114060671;
export const METRIKA_CHOICE_KEY = "sidzen_metrika_choice_v1";
export const METRIKA_SETTINGS_EVENT = "sidzen:metrika-settings";
const CHOICE_LIFETIME = 180 * 24 * 60 * 60 * 1000;
export type MetrikaChoice = "accepted" | "rejected";

export function readMetrikaChoice(storage: Pick<Storage, "getItem">, now = Date.now()): MetrikaChoice | null {
  try {
    const value: unknown = JSON.parse(storage.getItem(METRIKA_CHOICE_KEY) ?? "null");
    if (!value || typeof value !== "object") return null;
    const record = value as { choice?: unknown; at?: unknown };
    if ((record.choice !== "accepted" && record.choice !== "rejected") || typeof record.at !== "number" || !Number.isFinite(record.at) || record.at > now || now - record.at >= CHOICE_LIFETIME) return null;
    return record.choice;
  } catch { return null; }
}

export function metrikaPublicUrl(href: string): string | null {
  try {
    const url = new URL(href);
    const path = publicMonitoringPath(url.pathname);
    // Allow only the fixed Yandex debug flag; arbitrary parameters may contain personal data.
    const params = [...url.searchParams.entries()];
    const debugOnly = params.length === 1 && params[0][0] === "_ym_debug" && /^[012]$/.test(params[0][1]);
    return path && (!url.search || debugOnly) && !url.hash ? `${url.origin}${path}` : null;
  } catch { return null; }
}
