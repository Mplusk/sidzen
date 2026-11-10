"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { quoteOzonDelivery } from "@/app/actions/ozon-delivery";
import type { PickupPoint } from "@/lib/delivery/points";
import type { PickupMapCity } from "@/lib/delivery/point-viewport";
import { deliveryCheckIssue, withDeliveryDeadline } from "@/lib/delivery/picker-state";
import { OzonPointSearch } from "@/components/ozon-point-search";
import { PickupPointDialog } from "@/components/pickup-point-dialog";
import styles from "./ozon-delivery-picker.module.css";

export type DeliveryQuoteView = { token: string; cost: number; days: number; address: string };

export function OzonDeliveryPicker({ phone, onEditPhone, onQuote, packingReady = true, verificationRevision = 0 }: { phone: string; onEditPhone: () => void; onQuote: (value: DeliveryQuoteView | null) => void; packingReady?: boolean; verificationRevision?: number }) {
  const [consent, setConsent] = useState(false);
  const [city, setCity] = useState<PickupMapCity | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<PickupPoint | null>(null);
  const point = selectedPoint?.id ?? "";
  const [pending, setPending] = useState<"quote" | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [recipientError, setRecipientError] = useState(false);
  const [quote, setQuote] = useState<(DeliveryQuoteView & { phone: string; verificationRevision: number }) | null>(null);
  const [lastVerificationRevision, setLastVerificationRevision] = useState(verificationRevision);
  if (lastVerificationRevision !== verificationRevision) { setLastVerificationRevision(verificationRevision); setQuote(null); setPending(null); }
  const [lastPhone, setLastPhone] = useState(phone);
  if (lastPhone !== phone) { setLastPhone(phone); setQuote(null); setMessage(""); setRecipientError(false); }
  const phoneRef = useRef(phone);
  useEffect(() => { phoneRef.current = phone; }, [phone]);
  const revision = useRef(0);
  const nextStep = useRef<HTMLDivElement>(null);
  const scrollFrame = useRef<number | null>(null);
  useEffect(() => () => { revision.current++; }, [verificationRevision]);
  useEffect(() => () => { revision.current++; if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current); }, []);
  function clearQuote() { revision.current++; setQuote(null); onQuote(null); setMessage(""); setRecipientError(false); setPending(null); if (scrollFrame.current !== null) { cancelAnimationFrame(scrollFrame.current); scrollFrame.current = null; } }
  function selectPoint(id: string, value: PickupPoint) {
    setMapOpen(false); setSelectedPoint(value); clearQuote();
    if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
    if (!id) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null;
      // Announce the next step without opening a mobile keyboard or moving the page twice.
      nextStep.current?.focus({ preventScroll: true });
      nextStep.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" });
    });
  }
  async function calculate() {
    const issue = deliveryCheckIssue(phone, point, consent, packingReady);
    if (issue) { setMessage(issue); setRecipientError(issue === deliveryCheckIssue(phone, "selected", true, true)); return; }
    clearQuote(); setPending("quote"); const version = revision.current; const requestedPhone = phone;
    try {
      const result = await withDeliveryDeadline(quoteOzonDelivery(phone, point, consent));
      if (version !== revision.current || phoneRef.current !== requestedPhone) return;
      if ("token" in result) { const value = result as DeliveryQuoteView; setQuote({ ...value, phone: requestedPhone, verificationRevision }); onQuote(value); }
      else { setMessage(result.error); setRecipientError("reason" in result && result.reason === "recipient"); }
    } catch { if (version === revision.current && phoneRef.current === requestedPhone) setMessage("Ozon не ответил на проверку доставки. Повторите попытку или выберите другой способ доставки."); }
    finally { if (version === revision.current) setPending(null); }
  }
  const checkIssue = deliveryCheckIssue(phone, point, consent, packingReady);
  return <div className={`ozon-delivery-picker ${styles.picker}`}>
    {!packingReady && <p className="notice notice--danger">Для одного из товаров магазин ещё не указал вес и размеры упакованной посылки. Проверка Ozon недоступна — выберите другую доставку или обратитесь в магазин.</p>}
    <OzonPointSearch onReset={() => { setMapOpen(false); setSelectedPoint(null); setCity(null); clearQuote(); }} onCity={value => { setCity(value); setMapOpen(true); }} onOpen={city ? () => setMapOpen(true) : undefined} actionLabel={point ? "Изменить" : "Выбрать на карте"} renderAction={action => <div className={styles.carrier} data-selected={!!point}>
      <span className={styles.logo}><Image src="/brand/ozon-delivery.svg" alt="Ozon" width={83} height={20} /></span>
      <div className={styles.service}><strong>Ozon Доставка</strong><small>{quote ? `Примерно ${quote.days} дн. после отгрузки` : "Пункт выдачи или постамат"}</small></div>
      <strong className={styles.price}>Бесплатно</strong>
      <div className={styles.address}>{selectedPoint ? <div className={`ozon-point-confirmation ${styles.confirmation}`} role="status"><span>{selectedPoint.address}</span>{!quote && <small>Доставка и телефон ещё не проверены</small>}</div> : <span className={styles.placeholder}>Выберите пункт выдачи</span>}</div>
      <div className={styles.mapButton}>{action}</div>
    </div>} />
    {city && mapOpen && <PickupPointDialog city={city} selectedPoint={selectedPoint ?? undefined} selected={point} carrier="Ozon" onSelect={selectPoint} onClose={() => setMapOpen(false)} />}
    <div ref={nextStep} className="ozon-recipient-step" tabIndex={-1} aria-label="Телефон получателя и проверка доставки">
    {point && <div className={styles.verification}>
    <label className="checkout-consent"><input type="checkbox" name="ozonConsent" checked={consent} required onChange={event => { setConsent(event.target.checked); clearQuote(); }} /><span>Даю отдельное <Link href="/legal/consent/?purpose=ozon" target="_blank">согласие на передачу номера Ozon для проверки и расчёта доставки</Link>. Без согласия можно выбрать другой способ доставки.</span></label>
    {checkIssue && message !== checkIssue && <p className="notice" id="ozon-check-help">{checkIssue}</p>}
    <button type="button" className="button button--small" onClick={calculate} disabled={!!pending} aria-describedby={message ? "ozon-check-message" : checkIssue ? "ozon-check-help" : undefined}>{pending === "quote" ? "Проверяем доставку…" : "Проверить доставку в выбранный ПВЗ"}</button>
    {pending === "quote" && <p className="notice" role="status">Проверяем доступность ПВЗ и срок доставки в Ozon… При временном сбое повторим автоматически. Обычно это быстро, но проверка может занять около 45 секунд.</p>}
    {message && <p className="notice" role="alert" id="ozon-check-message">{message}</p>}
    {message && recipientError && <button type="button" className="text-link" onClick={onEditPhone}>Изменить телефон получателя</button>}
    {quote && quote.phone === phone && quote.verificationRevision === verificationRevision && <p className="notice notice--success" role="status"><strong>Доставка бесплатная · 0 ₽</strong><br />Ozon подтвердил доступность доставки для этого номера.<br />{quote.address}<br />Примерно {quote.days} дн. в пути после отгрузки. Проверка действительна 15 минут.</p>}
    </div>}
    </div>
  </div>;
}
