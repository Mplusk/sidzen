import { publicMonitoringPath } from "@/lib/monitoring-policy";

export const METRIKA_ID = 114060671;
export const METRIKA_CHOICE_KEY = "sidzen_metrika_choice_v1";
export const METRIKA_SETTINGS_EVENT = "sidzen:metrika-settings";
export const CHOICE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;
export type MetrikaChoice = "accepted" | "rejected";
export type StatisticsPreference = { choice: MetrikaChoice; topMail: boolean };

export function readMetrikaChoice(storage: Pick<Storage, "getItem">, now = Date.now()): StatisticsPreference | null {
  try {
    const value: unknown = JSON.parse(storage.getItem(METRIKA_CHOICE_KEY) ?? "null");
    if (!value || typeof value !== "object") return null;
    const record = value as { choice?: unknown; at?: unknown; topMail?: unknown };
    if ((record.choice !== "accepted" && record.choice !== "rejected") || typeof record.at !== "number" || !Number.isFinite(record.at) || record.at > now || now - record.at >= CHOICE_MAX_AGE_SECONDS * 1000) return null;
    return { choice: record.choice, topMail: record.choice === "accepted" && record.topMail === true };
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
