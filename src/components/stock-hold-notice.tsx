"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Refresh at the end of the visible hold without resetting form fields. */
export function StockHoldNotice({ expiresAt }: { expiresAt: string | null }) {
  const router = useRouter();
  useEffect(() => {
    if (!expiresAt) return;
    const remaining = Date.parse(expiresAt) - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) return;
    const timer = window.setTimeout(() => router.refresh(), Math.min(remaining + 1000, 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [expiresAt, router]);
  if (!expiresAt) return null;
  const date = new Date(expiresAt);
  if (!Number.isFinite(date.getTime())) return null;
  const formatted = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(date);
  return <p className="notice" role="status">Товары зарезервированы до {formatted} МСК.</p>;
}
