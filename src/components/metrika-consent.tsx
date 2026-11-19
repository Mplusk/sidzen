"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { CHOICE_MAX_AGE_SECONDS, METRIKA_CHOICE_KEY, METRIKA_ID, METRIKA_SETTINGS_EVENT, metrikaPublicUrl, readMetrikaChoice, type MetrikaChoice, type StatisticsPreference } from "@/lib/metrika-policy";
import { publicMonitoringPath } from "@/lib/monitoring-policy";
import { TOP_MAIL_COOKIE, TOP_MAIL_ENDPOINT } from "@/lib/top-mail";

type Ym = ((id: number, command: string, ...args: unknown[]) => void) & { a?: unknown[][]; l?: number };
type MetrikaWindow = Window & { ym?: Ym; disableYaCounter114060671?: boolean; dataLayer?: unknown[] };
let loadPromise: Promise<void> | null = null;

function loadMetrika(): Promise<void> {
  if (loadPromise) return loadPromise;
  const w = window as MetrikaWindow;
  if (!w.ym) {
    const queue: Ym = (...args: unknown[]) => { (queue.a ??= []).push(args); };
    queue.l = Date.now();
    w.ym = queue;
  }
  loadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://mc.yandex.ru/metrika/tag.js?id=${METRIKA_ID}`;
    script.onload = () => resolve();
    script.onerror = () => { script.remove(); loadPromise = null; reject(new Error("Yandex Metrica failed to load")); };
    document.head.appendChild(script);
  });
  return loadPromise;
}

function removeAnalyticsCookies() {
  for (const entry of document.cookie.split(";")) {
    const name = entry.trim().split("=", 1)[0];
    if (!name.startsWith("_ym_") && !name.startsWith("tmr_")) continue;
    document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
    document.cookie = `${name}=; Max-Age=0; Path=/; Domain=${location.hostname}; SameSite=Lax`;
    const parts = location.hostname.split(".");
    if (parts.length > 2) document.cookie = `${name}=; Max-Age=0; Path=/; Domain=.${parts.slice(-2).join(".")}; SameSite=Lax`;
  }
}

function privacySignal() {
  return navigator.doNotTrack === "1" || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
}

export function MetrikaConsent({ topMailEnabled = false }: { topMailEnabled?: boolean }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const [preference, setPreference] = useState<StatisticsPreference | null>(null);
  const choice = preference?.choice ?? null;
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [hasFragment, setHasFragment] = useState(false);
  const active = useRef(false);
  const generation = useRef(0);
  const stop = useCallback(() => {
    generation.current++;
    const w = window as MetrikaWindow;
    if (active.current) w.ym?.(METRIKA_ID, "destruct");
    active.current = false;
    w.disableYaCounter114060671 = true;
  }, []);

  useEffect(() => {
    const w = window as MetrikaWindow;
    w.disableYaCounter114060671 = true;
    let mounted = true;
    queueMicrotask(() => {
      if (!mounted) return;
      setBlocked(privacySignal());
      setHasFragment(Boolean(location.hash));
      try { setPreference(readMetrikaChoice(localStorage)); } catch { /* No storage means no consent. */ }
      setReady(true);
    });
    const open = () => setSettings(true);
    const syncFragment = () => setHasFragment(Boolean(location.hash));
    const sync = (event: StorageEvent) => {
      if (event.key !== METRIKA_CHOICE_KEY && event.key !== null) return;
      try {
        const saved = readMetrikaChoice(localStorage);
        if (saved?.choice !== "accepted") stop();
        setPreference(saved);
      } catch { stop(); setPreference(null); }
    };
    const beforeNavigation = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || (anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      try {
        const target = new URL(anchor.href, location.href);
        if (target.origin === location.origin && target.href !== location.href) stop();
      } catch { /* Ignore invalid links. */ }
    };
    window.addEventListener(METRIKA_SETTINGS_EVENT, open);
    window.addEventListener("storage", sync);
    window.addEventListener("hashchange", syncFragment);
    window.addEventListener("popstate", stop);
    document.addEventListener("click", beforeNavigation, true);
    return () => { mounted = false; window.removeEventListener(METRIKA_SETTINGS_EVENT, open); window.removeEventListener("storage", sync); window.removeEventListener("hashchange", syncFragment); window.removeEventListener("popstate", stop); document.removeEventListener("click", beforeNavigation, true); stop(); };
  }, [stop]);

  useEffect(() => {
    stop();
    if (!ready || choice !== "accepted" || blocked) return;
    const url = metrikaPublicUrl(window.location.href);
    if (!url) return;
    const version = generation.current;
    void loadMetrika().then(() => {
      if (generation.current !== version || metrikaPublicUrl(window.location.href) !== url) return;
      const w = window as MetrikaWindow;
      w.disableYaCounter114060671 = false;
      w.dataLayer ??= [];
      w.ym?.(METRIKA_ID, "init", { ssr: true, webvisor: true, clickmap: true, ecommerce: "dataLayer", accurateTrackBounce: true, trackLinks: true, defer: true, url, referrer: "" });
      active.current = true;
      w.ym?.(METRIKA_ID, "hit", url, { referer: "" });
    }).catch(() => {});
    return stop;
  }, [pathname, search, choice, ready, blocked, stop]);

  const choose = (next: MetrikaChoice) => {
    if (next === "rejected") stop();
    const allowTopMail = next === "accepted" && topMailEnabled && !blocked;
    const cookieOptions = `Path=${TOP_MAIL_ENDPOINT}; SameSite=Strict${location.protocol === "https:" ? "; Secure" : ""}`;
    try {
      if (!allowTopMail) document.cookie = `${TOP_MAIL_COOKIE}=; Max-Age=0; ${cookieOptions}`;
      if (next === "rejected") {
        removeAnalyticsCookies();
        localStorage.removeItem("tmr_lvid");
        localStorage.removeItem("tmr_lvidTS");
      }
      localStorage.setItem(METRIKA_CHOICE_KEY, JSON.stringify({ choice: next, at: Date.now(), topMail: allowTopMail }));
      if (allowTopMail) document.cookie = `${TOP_MAIL_COOKIE}=1; Max-Age=${CHOICE_MAX_AGE_SECONDS}; ${cookieOptions}`;
      setPreference({ choice: next, topMail: allowTopMail });
    } catch { stop(); setPreference(null); }
    setSettings(false);
  };

  const path = topMailEnabled && !search.toString() ? publicMonitoringPath(pathname) : null;
  const counter = path && <iframe key={path} hidden title="Top.Mail.Ru" referrerPolicy="no-referrer" src={`${TOP_MAIL_ENDPOINT}?page=${encodeURIComponent(path)}`} />;
  const needsChoice = choice === null || (choice === "accepted" && topMailEnabled && !preference?.topMail);
  const showSettings = ready && (settings || (needsChoice && !blocked));
  return <>
    {!ready && counter && <noscript>{counter}</noscript>}
    {ready && preference?.topMail && !blocked && !hasFragment && counter}
    {showSettings && <aside className="metrika-consent" aria-label="Настройки статистики" role="region">
      <p>Необходимые cookies помогают работе сайта. С вашего согласия Яндекс Метрика собирает статистику и записывает действия на публичных страницах с помощью Вебвизора.{topMailEnabled && " Top.Mail.Ru учитывает просмотры этих страниц."} <Link href="/legal/cookies/">Подробнее о cookies и статистике</Link>.</p>
      {blocked && <p>В браузере включён запрет отслеживания, поэтому статистика не запускается.</p>}
      <div className="metrika-consent__actions">
        <button type="button" onClick={() => choose("rejected")}>Только необходимые</button>
        {!blocked && <button type="button" onClick={() => choose("accepted")}>Разрешить статистику</button>}
      </div>
    </aside>}
  </>;
}
