"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const INTERVAL = 60 * 60 * 1000;

/** Refresh only an open cart/checkout, including after a suspended tab wakes. */
export function CartAvailabilityRefresh({ enabled = true }: { enabled?: boolean }) {
  const router = useRouter();
  const lastCheck = useRef(0);
  useEffect(() => {
    if (!enabled) return;
    if (!lastCheck.current) lastCheck.current = Date.now();
    let timer: number;
    const check = () => {
      window.clearTimeout(timer);
      const remaining = INTERVAL - (Date.now() - lastCheck.current);
      if (remaining <= 0 && document.visibilityState === "visible") {
        lastCheck.current = Date.now();
        router.refresh();
      }
      timer = window.setTimeout(check, remaining <= 0 ? (document.visibilityState === "visible" ? INTERVAL : 60_000) : remaining);
    };
    document.addEventListener("visibilitychange", check);
    check();
    return () => { window.clearTimeout(timer); document.removeEventListener("visibilitychange", check); };
  }, [enabled, router]);
  return null;
}
