"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";

const subscribe = () => () => {};
const clientSnapshot = () => {
  try { return !localStorage.getItem("3dp_cookie_consent"); } catch { return true; }
};
const serverSnapshot = () => false;

export function CookieBanner() {
  const needsConsent = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const [dismissed, setDismissed] = useState(false);
  const accept = (consent: string) => {
    try { localStorage.setItem("3dp_cookie_consent", consent); } catch { /* Keep the banner dismissible when storage is unavailable. */ }
    setDismissed(true);
  };
  if (!needsConsent || dismissed) return null;
  return (
    <div className="cookie-banner" role="dialog" aria-label="Использование cookies">
      <p>Используем только необходимые cookies для корзины, входа и доступа к заказу. Рекламных счётчиков и аналитики нет. <Link href="/legal/cookies/">Подробнее</Link></p>
      <div><button className="button button--small" onClick={() => accept("necessary")}>Понятно</button></div>
    </div>
  );
}
