"use client";

import { useState } from "react";
import Link from "next/link";
import { chooseStatistics, statisticsPrivacySignal, useStatisticsChoice } from "@/lib/monitoring-preferences";

export function CookieBanner({ settings = false }: { settings?: boolean }) {
  const choice = useStatisticsChoice(), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function choose(value: "allow" | "deny") {
    setBusy(true); setError("");
    try { await chooseStatistics(value); } catch (error) { setError(error instanceof Error ? error.message : "Ошибка сохранения"); } finally { setBusy(false); }
  }
  if (choice && !settings) return null;
  return <div className={settings ? "card" : "cookie-banner"} role={settings ? undefined : "region"} aria-label="Настройки cookies">
    <p>Необходимые cookies поддерживают корзину и вход. Отдельно можно разрешить статистику посещений: IP, источник, поиск в каталоге, просмотренные публичные страницы и активное время. Хранение в России, до 30 дней, без внешних счётчиков. <Link href="/legal/consent/?purpose=monitoring">Согласие на статистику</Link> · <Link href="/legal/cookies/">Настройки</Link></p>
    {settings && <p>Статистика: {choice === "allow" ? "разрешена" : "отключена"}. Отключение также удалит статистику этого браузера.</p>}
    <div className="statistics-choice"><button className="button button--outline button--small" disabled={busy} onClick={() => choose("deny")}>{settings ? "Отключить и удалить мою статистику" : "Только необходимые"}</button><button className="button button--outline button--small" disabled={busy} onClick={() => {
      if (statisticsPrivacySignal()) { setError("В браузере включён запрет отслеживания. Статистику не собираем."); return; } void choose("allow");
    }}>Разрешить статистику</button></div>
    {error && <p role="alert">{error}</p>}
  </div>;
}
