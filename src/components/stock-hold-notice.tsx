"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Refresh silently at expiry and while the worker finalizes an unpaid order. */
export function StockHoldNotice({ expiresAt }: { expiresAt: string | null }) {
  const router = useRouter();
  useEffect(() => {
    if (!expiresAt) return;
    const deadline = Date.parse(expiresAt);
    if (!Number.isFinite(deadline)) return;
    let timer: number;
    const check = () => {
      const remaining = deadline - Date.now();
      timer = window.setTimeout(() => { router.refresh(); check(); }, remaining <= 0 ? 10_000 : Math.min(remaining + 1000, 2_147_483_647));
    };
    check();
    return () => window.clearTimeout(timer);
  }, [expiresAt, router]);
  return null;
}
