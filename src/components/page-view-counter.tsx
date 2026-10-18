"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { publicMonitoringPath } from "@/lib/monitoring-policy";

export function PageViewCounter() {
  const pathname = usePathname(), counted = useRef<string | null>(null);
  useEffect(() => {
    // Remove only retired statistics state, never cart/login/order storage.
    try { localStorage.removeItem("sidzen_statistics_choice_v1"); localStorage.removeItem("3dp_cookie_notice"); sessionStorage.removeItem("sidzen_statistics_visit"); } catch { /* Storage may be disabled. */ }
    void fetch("/api/monitoring/consent/", { method: "POST", credentials: "same-origin", referrerPolicy: "no-referrer" }).catch(() => {});
  }, []);
  useEffect(() => {
    const path = publicMonitoringPath(pathname);
    if (!path || navigator.doNotTrack === "1" || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true) { counted.current = null; return; }
    const count = () => {
      if (document.visibilityState !== "visible" || counted.current === path) return;
      counted.current = path;
      // No IDs, query/referrer, account, timings, heartbeat or interactions.
      void fetch("/api/page-views/", { method: "POST", credentials: "omit", referrerPolicy: "no-referrer", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) }).catch(() => {});
    };
    count(); document.addEventListener("visibilitychange", count);
    return () => document.removeEventListener("visibilitychange", count);
  }, [pathname]);
  return null;
}
