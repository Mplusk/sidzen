"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { resetStatisticsChoice, statisticsPrivacySignal, useStatisticsChoice } from "@/lib/monitoring-preferences";

// No auth/account/admin/checkout, order links, forms or arbitrary query strings.
const publicPath = /^\/(?:catalog(?:\/[\p{L}\p{N}_-]+){0,3}|about|contacts|faq|delivery|legal\/(?:privacy|cookies|offer|consent))\/?$/u;
export function MonitoringTracker() {
  const choice = useStatisticsChoice(), pathname = usePathname(), params = useSearchParams();
  const search = params.get("q")?.slice(0, 120), campaign = params.get("utm_campaign")?.slice(0, 80);
  useEffect(() => {
    if (choice !== "allow" || !publicPath.test(pathname) || statisticsPrivacySignal()) return;
    let visit = crypto.randomUUID(), last = Date.now();
    try {
      const saved = JSON.parse(sessionStorage.getItem("sidzen_statistics_visit") ?? "null");
      if (saved && Date.now() - saved.at < 1800000 && /^[\da-f-]{36}$/.test(saved.id)) visit = saved.id;
      sessionStorage.setItem("sidzen_statistics_visit", JSON.stringify({ id: visit, at: Date.now() }));
    } catch { /* A fresh visit is safe when session storage is unavailable. */ }
    const page = crypto.randomUUID(); let seconds = 0, idleAt = Date.now(), stopped = false, ready = false;
    const base = { visit, page };
    const send = (beacon = false) => {
      if (!ready || stopped) return;
      const body = JSON.stringify({ ...base, type: "heartbeat", seconds: Math.floor(seconds) });
      if (beacon && navigator.sendBeacon) navigator.sendBeacon("/api/monitoring/", new Blob([body], { type: "application/json" }));
      else void fetch("/api/monitoring/", { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" } }).catch(() => {});
      if (Date.now() - idleAt < 60000) try { sessionStorage.setItem("sidzen_statistics_visit", JSON.stringify({ id: visit, at: Date.now() })); } catch { /* Optional. */ }
    };
    const controller = new AbortController();
    void fetch("/api/monitoring/", { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify({ ...base, type: "view", path: pathname, ...(search ? { search } : {}), ...(campaign ? { campaign } : {}), referrer: document.referrer.slice(0, 1000) }) }).then(response => {
      ready = response.ok; if (response.status === 403) resetStatisticsChoice();
    }).catch(() => {});
    const activity = () => { idleAt = Date.now(); };
    const tick = setInterval(() => { const now = Date.now(); if (document.visibilityState === "visible" && now - idleAt < 60000) seconds += Math.min(2, (now - last) / 1000); last = now; }, 1000);
    const heartbeat = setInterval(() => send(), 30000);
    const visibility = () => { if (document.visibilityState === "hidden") send(true); else { last = Date.now(); idleAt = last; } };
    const leave = () => send(true);
    for (const type of ["pointerdown", "keydown", "scroll"]) window.addEventListener(type, activity, { passive: true });
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", leave);
    return () => {
      send(true); stopped = true; controller.abort(); clearInterval(tick); clearInterval(heartbeat);
      for (const type of ["pointerdown", "keydown", "scroll"]) window.removeEventListener(type, activity);
      document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", leave);
    };
  }, [choice, pathname, search, campaign]);
  return null;
}
