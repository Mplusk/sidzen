"use client";

import { useSyncExternalStore } from "react";
const KEY = "sidzen_statistics_choice_v1", EVENT = "sidzen-statistics-choice";
let fallback: "allow" | "deny" | null = null, fallbackUntil = 0;
function snapshot() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return saved?.expires > Date.now() && (saved.choice === "allow" || saved.choice === "deny") ? saved.choice as "allow" | "deny" : fallbackUntil > Date.now() ? fallback : null;
  } catch { return fallbackUntil > Date.now() ? fallback : null; }
}
function subscribe(callback: () => void) {
  window.addEventListener("storage", callback); window.addEventListener(EVENT, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(EVENT, callback); };
}
export function useStatisticsChoice() { return useSyncExternalStore(subscribe, snapshot, () => null); }
export function resetStatisticsChoice() {
  fallback = null; fallbackUntil = 0; try { localStorage.removeItem(KEY); } catch { /* Storage may be disabled. */ }
  window.dispatchEvent(new Event(EVENT));
}
export async function chooseStatistics(choice: "allow" | "deny") {
  const response = await fetch(`/api/monitoring/consent/?choice=${choice}`, { method: "POST", credentials: "same-origin" });
  if (!response.ok) throw new Error("Не удалось сохранить выбор. Попробуйте ещё раз.");
  fallback = choice;
  fallbackUntil = Date.now() + 30 * 86400000;
  try { localStorage.setItem(KEY, JSON.stringify({ choice, expires: Date.now() + 30 * 86400000 })); } catch { /* Session-local choice remains available. */ }
  window.dispatchEvent(new Event(EVENT));
}
export function statisticsPrivacySignal() { return navigator.doNotTrack === "1" || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true; }
