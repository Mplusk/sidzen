"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
export function MarketplaceProgress({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(timer);
  }, [active, router]);
  return active ? <p role="status" className="muted">Синхронизация выполняется в фоне. Результат обновляется автоматически; страницу можно закрыть.</p> : null;
}
