"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { PickupPoint } from "@/lib/delivery/points";
import styles from "./pickup-point-dialog.module.css";

const FallbackMap = dynamic(() => import("./ozon-pickup-map"), { ssr: false });
const YandexMap = dynamic(() => import("./yandex-pickup-map"), { ssr: false });

export default function PickupMapProvider({ points, selected, onSelect, carrier }: {
  points: PickupPoint[]; selected: string; onSelect: (id: string) => void; carrier: "Ozon" | "СДЭК";
}) {
  const [key, setKey] = useState<string | null>(null);
  const [mode, setMode] = useState<"choice" | "yandex" | "fallback">("choice");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/maps/yandex-config/", { cache: "no-store", signal: controller.signal })
      .then(response => response.ok ? response.json() : Promise.reject(new Error("map-config")))
      .then((data: { apiKey?: string }) => { setKey(data.apiKey || ""); if (!data.apiKey) setMode("fallback"); })
      .catch(() => { if (!controller.signal.aborted) { setKey(""); setMode("fallback"); } });
    return () => controller.abort();
  }, []);
  if (key === null) return <div className={styles.mapLoading} role="status">Загружаем карту…</div>;
  if (mode === "choice" && key) return <div className={styles.mapConsent}>
    <h3>Яндекс Карты</h3>
    <p>Для показа карты Яндекс может получать IP-адрес, сведения об устройстве и приблизительное местоположение. Нажимая «Разрешить и показать», вы соглашаетесь на передачу и обработку этих данных Яндексом. Подробнее — в <a href="/legal/privacy/" target="_blank" rel="noreferrer">политике конфиденциальности</a> и <a href="https://yandex.ru/legal/confidential/" target="_blank" rel="noreferrer">политике Яндекса</a>.</p>
    <div className={styles.mapConsentActions}><button type="button" className="button button--small" onClick={() => setMode("yandex")}>Разрешить и показать</button><button type="button" className="button button--small button--outline" onClick={() => setMode("fallback")}>Другая карта</button></div>
  </div>;
  if (mode === "yandex" && key) return <YandexMap apiKey={key} points={points} selected={selected} onSelect={onSelect} carrier={carrier} onError={() => { setFailed(true); setMode("fallback"); }} />;
  return <><FallbackMap points={points} selected={selected} onSelect={onSelect} carrier={carrier} openPopupOnSelect={false} />{failed && <p className="muted" role="status">Яндекс Карты временно недоступны. Показана другая карта.</p>}</>;
}
