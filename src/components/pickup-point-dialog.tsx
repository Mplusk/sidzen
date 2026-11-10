"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { hasPointCoordinates, type PickupPoint } from "@/lib/delivery/points";
import type { PickupMapCity } from "@/lib/delivery/point-viewport";
import { usePickupViewport } from "@/components/use-pickup-viewport";
import styles from "./pickup-point-dialog.module.css";

const PickupMap = dynamic(() => import("@/components/ozon-pickup-map"), {
  ssr: false,
  loading: () => <div className={styles.mapLoading} role="status">Загружаем карту…</div>,
});

type Point = PickupPoint & { workTime?: string };
const LIST_PAGE_SIZE = 100;
const EMPTY_POINTS: Point[] = [];

export function PickupPointDialog({ points: staticPoints = EMPTY_POINTS, city, selectedPoint, selected, carrier, onSelect, onClose }: {
  points?: Point[];
  city?: PickupMapCity;
  selectedPoint?: Point;
  selected: string;
  carrier: "Ozon" | "СДЭК";
  onSelect: (id: string, point: Point) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const listId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const sidebar = useRef<HTMLElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const focusConfirmation = useRef(false);
  const focusRevision = useRef(0);
  const area = usePickupViewport(Boolean(city));
  const points: Point[] = city ? area.listPoints : staticPoints;
  const markerPoints: Point[] = city ? area.points : staticPoints;
  const [highlighted, setHighlighted] = useState(selected);
  const [preview, setPreview] = useState<Point | undefined>(selectedPoint ?? points.find(point => point.id === selected));
  const [focusRequest, setFocusRequest] = useState<{ id: string; revision: number }>();
  const [listState, setListState] = useState({ points, visibleCount: LIST_PAGE_SIZE });
  if (listState.points !== points) setListState({ points, visibleCount: LIST_PAGE_SIZE });
  const visibleCount = listState.points === points ? listState.visibleCount : LIST_PAGE_SIZE;
  const chosen = points.find(point => point.id === highlighted) ?? markerPoints.find(point => point.id === highlighted) ?? (preview?.id === highlighted ? preview : undefined);
  const mapped = Boolean(city) || markerPoints.some(hasPointCoordinates);
  const mapPoints = useMemo(() => chosen && !markerPoints.some(point => point.id === chosen.id) ? [...markerPoints, chosen] : markerPoints, [markerPoints, chosen]);
  function highlight(id: string, fromList = false, keyboard = false) {
    const value = points.find(point => point.id === id) ?? mapPoints.find(point => point.id === id);
    if (!value) return;
    focusConfirmation.current = keyboard;
    setHighlighted(id); setPreview(value);
    if (fromList && hasPointCoordinates(value)) setFocusRequest({ id, revision: ++focusRevision.current });
    else setFocusRequest(undefined);
  }
  const carrierLogo = <Image src={carrier === "Ozon" ? "/brand/ozon-delivery.svg" : "/brand/cdek.svg"} alt={carrier} width={83} height={24} className={styles.logo} />;

  // Leaflet measures its container in a passive effect. Open the dialog before
  // that effect runs so fitBounds uses the visible map size on every opening.
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (typeof element.showModal === "function") element.showModal();
    else element.setAttribute("open", "");
    return () => { if (element.open && typeof element.close === "function") element.close(); if (trigger?.isConnected) trigger.focus({ preventScroll: true }); };
  }, []);
  useLayoutEffect(() => {
    if (!highlighted) return;
    // On a narrow screen the preview shares the scrolling address panel.
    // Bring it back into view without moving the map or the whole page.
    if (sidebar.current) sidebar.current.scrollTop = 0;
    if (focusConfirmation.current) { focusConfirmation.current = false; confirmButton.current?.focus({ preventScroll: true }); }
  }, [highlighted, focusRequest]);

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className={styles.shell}>
      <header className={styles.header}><div className={styles.heading}><h2 id={titleId}>Выберите пункт выдачи</h2>{carrierLogo}</div><button type="button" className={styles.close} aria-label="Закрыть выбор пункта" onClick={onClose}><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M5 5l14 14M19 5L5 19" /></svg></button></header>
      <div className={styles.content}>
        <div className={styles.map}>{mapped ? <PickupMap carrier={carrier} points={mapPoints} clusters={city ? area.clusters : undefined} initialBounds={city?.bounds} onViewportChange={city ? area.onViewportChange : undefined} selected={highlighted} focusRequest={focusRequest} onSelect={id => highlight(id)} openPopupOnSelect={false} /> : <p className={styles.mapLoading}>Карта для этих адресов недоступна. Выберите пункт из списка.</p>}</div>
        <aside ref={sidebar} className={styles.sidebar} aria-label={`Пункты выдачи ${carrier}`}>
          {chosen && <section className={styles.selection} aria-label="Выбранный пункт" aria-live="polite">
            <div className={styles.selectionHeading}>{carrierLogo}<span>{chosen.name || `Пункт ${carrier}`}</span></div>
            <p className={styles.selectedAddress}>{chosen.address}</p>
            {chosen.workTime && <p className={styles.hours}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>{chosen.workTime}</p>}
            <button ref={confirmButton} type="button" className={styles.confirm} onClick={() => onSelect(chosen.id, chosen)}>Выбрать этот пункт<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M5 12h14m-5-5 5 5-5 5" /></svg></button>
          </section>}
          <div className={styles.listHeading}><h3>Пункты выдачи</h3></div>
          {city && area.pending && <p className={styles.empty} role="status">Загружаем пункты в этой области…</p>}
          {city && area.error && <div className={styles.empty} role="alert"><p>{area.error}</p><button type="button" className="button button--outline button--small" onClick={area.retry}>Повторить загрузку</button></div>}
          <div id={listId} className={styles.list}>
          {points.slice(0, visibleCount).map(point => <button key={point.id} type="button" className={styles.point} aria-pressed={point.id === highlighted} onClick={event => highlight(point.id, true, event.detail === 0)}>
            <span className={styles.pointTop}><span>{point.name || `Пункт ${carrier}`}</span><svg className={styles.pointArrow} aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="m9 5 7 7-7 7" /></svg></span><strong>{point.address}</strong>{point.workTime && <small>{point.workTime}</small>}
          </button>)}
          {visibleCount < points.length && <button type="button" className="button button--outline button--small" aria-controls={listId} onClick={() => setListState({ points, visibleCount: visibleCount + LIST_PAGE_SIZE })}>Показать ещё</button>}
          {city && visibleCount >= points.length && area.nextOffset != null && <button type="button" className="button button--outline button--small" disabled={area.pending} onClick={() => void area.loadMore()}>Загрузить ещё пункты</button>}
          {city && !points.length && !!area.clusters.length && <p className={styles.empty}>Приблизьте нужный район, чтобы увидеть адреса пунктов.</p>}
          {!points.length && (!city || (!area.pending && !area.error && !area.clusters.length)) && <p className={styles.empty}>{city ? "В этой области пунктов нет. Переместите или отдалите карту." : "Пункты не найдены. Закройте карту и выберите другой город."}</p>}
          </div>
        </aside>
      </div>
    </div>
  </dialog>;
}
