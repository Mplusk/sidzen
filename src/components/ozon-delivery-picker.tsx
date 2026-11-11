"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { quoteOzonDelivery } from "@/app/actions/ozon-delivery";
import type { PickupPoint } from "@/lib/delivery/points";
import type { PickupMapCity } from "@/lib/delivery/point-viewport";
import { deliveryCheckIssue, withDeliveryDeadline } from "@/lib/delivery/picker-state";
import { OzonPointSearch } from "@/components/ozon-point-search";
import { PickupPointDialog } from "@/components/pickup-point-dialog";
import styles from "./ozon-delivery-picker.module.css";

export type DeliveryQuoteView = { token: string; cost: number; days: number; address: string; estimatedDate: string | null; estimatedDateText: string | null };
type CheckResult =
  | { key: string; status: "success"; value: DeliveryQuoteView }
  | { key: string; status: "error"; message: string; recipient: boolean };

export function OzonDeliveryPicker({ phone, onEditPhone, onQuote, packingReady = true, verificationRevision = 0, cartPending = false }: { phone: string; onEditPhone: () => void; onQuote: (value: DeliveryQuoteView | null) => void; packingReady?: boolean; verificationRevision?: number; cartPending?: boolean }) {
  const [city, setCity] = useState<PickupMapCity | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<PickupPoint | null>(null);
  const point = selectedPoint?.id ?? "";
  const [mapOpen, setMapOpen] = useState(false);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [selectionVersion, setSelectionVersion] = useState(0);
  const [retryVersion, setRetryVersion] = useState(0);
  const quoteCallback = useRef(onQuote);
  useEffect(() => { quoteCallback.current = onQuote; }, [onQuote]);
  const revision = useRef(0);
  const nextStep = useRef<HTMLDivElement>(null);
  const scrollFrame = useRef<number | null>(null);
  useEffect(() => () => { revision.current++; if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current); }, []);
  const checkIssue = point ? deliveryCheckIssue(phone, point, packingReady) : "";
  const checkKey = JSON.stringify([point, selectionVersion, phone, verificationRevision, packingReady, cartPending, retryVersion]);
  const current = check?.key === checkKey ? check : null;
  const confirmedQuote = current?.status === "success" && !checkIssue && !cartPending ? current.value : null;
  const checking = !!point && !cartPending && !checkIssue && !current;
  const message = checkIssue || (current?.status === "error" ? current.message : "");
  const recipientError = (!!checkIssue && packingReady) || (current?.status === "error" && current.recipient);

  useEffect(() => {
    const version = ++revision.current;
    if (!point) return;
    const notify = quoteCallback.current;
    notify(null);
    if (cartPending || checkIssue) return;
    let active = true;
    // A short delay coalesces phone edits and repeated point selections.
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = await withDeliveryDeadline(quoteOzonDelivery(phone, point));
          if (!active || revision.current !== version) return;
          if ("token" in result) {
            const value = result as DeliveryQuoteView;
            setCheck({ key: checkKey, status: "success", value }); notify(value);
          } else setCheck({ key: checkKey, status: "error", message: result.error, recipient: "reason" in result && result.reason === "recipient" });
        } catch {
          if (active && revision.current === version) setCheck({ key: checkKey, status: "error", message: "Ozon не ответил на проверку доставки. Повторите попытку или выберите другой способ доставки.", recipient: false });
        }
      })();
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [checkKey, point, phone, cartPending, checkIssue]);

  function clearSelection() {
    revision.current++; onQuote(null); setCheck(null); setMapOpen(false); setSelectedPoint(null); setCity(null);
    if (scrollFrame.current !== null) { cancelAnimationFrame(scrollFrame.current); scrollFrame.current = null; }
  }
  function selectPoint(id: string, value: PickupPoint) {
    revision.current++; onQuote(null); setMapOpen(false); setSelectedPoint(value); setSelectionVersion(version => version + 1);
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    if (!id) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null;
      // Announce the next step without opening a mobile keyboard or moving the page twice.
      nextStep.current?.focus({ preventScroll: true });
      nextStep.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
    });
  }
  return <div className={`ozon-delivery-picker ${styles.picker}`}>
    {!packingReady && <p className="notice notice--danger" role="alert">Для одного из товаров магазин ещё не указал вес и размеры упаковки. Проверка Ozon недоступна — выберите другую доставку или обратитесь в магазин.</p>}
    <OzonPointSearch onReset={clearSelection} onCity={value => { setCity(value); setMapOpen(true); }} onOpen={city ? () => setMapOpen(true) : undefined} actionLabel={point ? "Изменить" : "Выбрать на карте"} renderAction={action => <div className={styles.carrier} data-selected={!!point}>
      <span className={styles.logo}><Image src="/brand/ozon-delivery.svg" alt="Ozon" width={83} height={20} /></span>
      <div className={styles.service}><strong>Ozon Доставка</strong>{confirmedQuote?.estimatedDate && confirmedQuote.estimatedDateText ? <><span className={styles.estimate}>Ориентировочно: <time dateTime={confirmedQuote.estimatedDate}>{confirmedQuote.estimatedDateText}</time></span><small>С учётом подготовки заказа</small></> : <small>{checking ? "Рассчитываем дату доставки…" : point ? "Дата доставки уточняется" : "Пункт выдачи или постамат"}</small>}</div>
      <strong className={styles.price}>Бесплатно</strong>
      <div className={styles.address}>{selectedPoint ? <div className={`ozon-point-confirmation ${styles.confirmation}`} role="status"><span>{selectedPoint.address}</span>{confirmedQuote ? <small className={styles.verified}>Ozon подтвердил доставку для этого номера.</small> : <small>Доставка и телефон ещё не проверены</small>}</div> : <span className={styles.placeholder}>Выберите пункт выдачи</span>}</div>
      <div className={styles.mapButton}>{action}</div>
    </div>} />
    {city && mapOpen && <PickupPointDialog city={city} selectedPoint={selectedPoint ?? undefined} selected={point} carrier="Ozon" onSelect={selectPoint} onClose={() => setMapOpen(false)} />}
    <div ref={nextStep} className="ozon-recipient-step" tabIndex={-1} aria-label="Телефон получателя и проверка доставки">
    {point && <div className={styles.verification}>
    {cartPending && <p className="notice" role="status">Обновляем корзину и расчёт доставки…</p>}
    {checking && <p className="notice" role="status">Проверяем доставку в выбранный ПВЗ и рассчитываем дату… При временном сбое повторим автоматически. Проверка может занять около 45 секунд.</p>}
    {message && packingReady && <p className="notice" role="alert" id="ozon-check-message">{message}</p>}
    {message && recipientError && <button type="button" className="text-link" onClick={onEditPhone}>Изменить телефон получателя</button>}
    {current?.status === "error" && <button type="button" className="button button--outline button--small" onClick={() => { revision.current++; setRetryVersion(version => version + 1); }}>Повторить проверку</button>}
    </div>}
    </div>
  </div>;
}
