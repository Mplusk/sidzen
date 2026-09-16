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
      <p>Используем необходимые cookies для корзины и кабинета. Аналитика включается только после согласия. <Link href="/legal/cookies/">Подробнее</Link></p>
      <div><button className="button button--small" onClick={() => accept("necessary")}>Только необходимые</button><button className="button button--small button--dark" onClick={() => accept("all")}>Принять</button></div>
    </div>
  );
}
