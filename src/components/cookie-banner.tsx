"use client";

import { useState } from "react";
import Link from "next/link";

export function CookieBanner() {
  const [visible, setVisible] = useState(() => typeof window !== "undefined" && !localStorage.getItem("3dp_cookie_consent"));
  if (!visible) return null;
  return (
    <div className="cookie-banner" role="dialog" aria-label="Использование cookies">
      <p>Используем необходимые cookies для корзины и кабинета. Аналитика включается только после согласия. <Link href="/legal/cookies/">Подробнее</Link></p>
      <div><button className="button button--small" onClick={() => { localStorage.setItem("3dp_cookie_consent", "necessary"); setVisible(false); }}>Только необходимые</button><button className="button button--small button--dark" onClick={() => { localStorage.setItem("3dp_cookie_consent", "all"); setVisible(false); }}>Принять</button></div>
    </div>
  );
}
