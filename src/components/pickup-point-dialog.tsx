"use client";

import dynamic from "next/dynamic";
import { useEffect, useId, useRef, useState } from "react";
import { hasPointCoordinates, type PickupPoint } from "@/lib/delivery/points";
import styles from "./pickup-point-dialog.module.css";

const PickupMap = dynamic(() => import("@/components/pickup-map-provider"), {
  ssr: false,
  loading: () => <div className={styles.mapLoading} role="status">Загружаем карту…</div>,
});

type Point = PickupPoint & { workTime?: string };

export function PickupPointDialog({ points, selected, carrier, onSelect, onClose }: {
  points: Point[];
  selected: string;
  carrier: "Ozon" | "СДЭК";
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [highlighted, setHighlighted] = useState(selected);
  const chosen = points.find(point => point.id === highlighted);
  const mapped = points.some(hasPointCoordinates);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (typeof element.showModal === "function") element.showModal();
    else element.setAttribute("open", "");
    return () => { if (element.open && typeof element.close === "function") element.close(); if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, []);

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={styles.shell}>
      <header className={styles.header}><div><h2 id={titleId}>Выберите пункт выдачи</h2><p>{carrier} · выберите на карте или в списке</p></div><button type="button" className={styles.close} aria-label="Закрыть выбор пункта" onClick={onClose}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 5l14 14M19 5L5 19" /></svg></button></header>
      <div className={styles.content}>
        <div className={styles.map}>{mapped ? <PickupMap carrier={carrier} points={points} selected={highlighted} onSelect={setHighlighted} /> : <p className={styles.mapLoading}>Карта для этих адресов недоступна. Выберите пункт из списка.</p>}</div>
        <div className={styles.list} aria-label={`Пункты выдачи ${carrier}`}>
          {points.map(point => <button key={point.id} type="button" className={styles.point} aria-pressed={point.id === highlighted} onClick={() => setHighlighted(point.id)}>
            <strong>{point.name || `Пункт ${carrier}`}</strong><span>{point.address}</span>{point.workTime && <small>{point.workTime}</small>}
          </button>)}
        </div>
      </div>
      <footer className={styles.footer}><span>{chosen ? chosen.address : "Выберите удобный пункт выдачи"}</span><button type="button" className="button button--small" disabled={!chosen} onClick={() => { if (chosen) onSelect(chosen.id); }}>Выбрать пункт</button></footer>
    </div>
  </dialog>;
}
