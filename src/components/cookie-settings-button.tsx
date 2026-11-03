"use client";

export function CookieSettingsButton() {
  return <button type="button" className="cookie-settings-link" onClick={() => window.dispatchEvent(new Event("sidzen:metrika-settings"))}>Настройки cookies</button>;
}
