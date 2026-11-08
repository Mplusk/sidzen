"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import { hasPointCoordinates, type PickupPoint } from "@/lib/delivery/points";
import styles from "./pickup-point-dialog.module.css";

const PickupMap = dynamic(() => import("@/components/ozon-pickup-map"), {
  ssr: false,
  loading: () => <div className={styles.mapLoading} role="status">Загружаем карту…</div>,
});

type Point = PickupPoint & { workTime?: string };
const LIST_PAGE_SIZE = 100;

export function PickupPointDialog({ points, selected, carrier, onSelect, onClose }: {
  points: Point[];
  selected: string;
  carrier: "Ozon" | "СДЭК";
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const listId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [highlighted, setHighlighted] = useState(selected);
  const [listState, setListState] = useState({ points, visibleCount: LIST_PAGE_SIZE });
  if (listState.points !== points) setListState({ points, visibleCount: LIST_PAGE_SIZE });
  const visibleCount = listState.points === points ? listState.visibleCount : LIST_PAGE_SIZE;
  const chosen = points.find(point => point.id === highlighted);
  const mapped = points.some(hasPointCoordinates);
  const carrierLogo = <Image src={carrier === "Ozon" ? "/brand/ozon-delivery.svg" : "/brand/cdek.svg"} alt={carrier} width={83} height={24} className={styles.logo} />;

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
      <header className={styles.header}><div><div className={styles.heading}><h2 id={titleId}>Выберите пункт выдачи</h2>{carrierLogo}</div><p>Найдите удобный адрес на карте или в списке</p></div><button type="button" className={styles.close} aria-label="Закрыть выбор пункта" onClick={onClose}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 5l14 14M19 5L5 19" /></svg></button></header>
      <div className={styles.content}>
        <div className={styles.map}>{mapped ? <PickupMap carrier={carrier} points={points} selected={highlighted} onSelect={setHighlighted} openPopupOnSelect={false} /> : <p className={styles.mapLoading}>Карта для этих адресов недоступна. Выберите пункт из списка.</p>}</div>
        <aside className={styles.sidebar} aria-label={`Пункты выдачи ${carrier}`}>
          {chosen && <section className={styles.selection} aria-label="Выбранный пункт" aria-live="polite">
            <div className={styles.selectionHeading}>{carrierLogo}<span>{chosen.name || `Пункт ${carrier}`}</span><svg className={styles.check} aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m5 12 4 4L19 6" /></svg></div>
            <p className={styles.selectedAddress}>{chosen.address}</p>
            {chosen.workTime && <p className={styles.hours}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>{chosen.workTime}</p>}
          </section>}
          <div className={styles.listHeading}><h3>Пункты выдачи</h3><span>{points.length}</span></div>
          <div id={listId} className={styles.list}>
          {points.slice(0, visibleCount).map(point => <button key={point.id} type="button" className={styles.point} aria-pressed={point.id === highlighted} onClick={() => setHighlighted(point.id)}>
            <span className={styles.pointTop}><span>{point.name || `Пункт ${carrier}`}</span><span className={styles.radio} aria-hidden="true">{point.id === highlighted && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="m5 12 4 4L19 6" /></svg>}</span></span><strong>{point.address}</strong>{point.workTime && <small>{point.workTime}</small>}
          </button>)}
          {visibleCount < points.length && <button type="button" className="button button--outline button--small" aria-controls={listId} onClick={() => setListState({ points, visibleCount: visibleCount + LIST_PAGE_SIZE })}>Показать ещё</button>}
          {!points.length && <p className={styles.empty}>Пункты не найдены. Закройте карту и выберите другой город.</p>}
          </div>
        </aside>
      </div>
      <footer className={styles.footer}><span>{chosen ? "Подтвердите выбранный пункт выдачи" : "Выберите удобный пункт выдачи"}</span><button type="button" className="button button--small" disabled={!chosen} onClick={() => { if (chosen) onSelect(chosen.id); }}>Выбрать пункт<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M5 12h14m-5-5 5 5-5 5" /></svg></button></footer>
    </div>
  </dialog>;
}
