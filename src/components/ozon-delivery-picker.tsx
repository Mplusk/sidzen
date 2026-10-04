"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { quoteOzonDelivery } from "@/app/actions/ozon-delivery";
import { hasPointCoordinates, type PickupPoint } from "@/lib/delivery/points";
import { deliveryCheckIssue, geolocationErrorMessage, locateDevice, withDeliveryDeadline } from "@/lib/delivery/picker-state";

const PickupMap = dynamic(() => import("@/components/ozon-pickup-map"), { ssr: false, loading: () => <p className="notice" role="status">Загружаем карту ПВЗ…</p> });
export type DeliveryQuoteView = { token: string; cost: number; days: number; address: string };

export function OzonDeliveryPicker({ phone, onQuote, packingReady = true }: { phone: string; onQuote: (value: DeliveryQuoteView | null) => void; packingReady?: boolean }) {
  const [consent, setConsent] = useState(false);
  const [query, setQuery] = useState("");
  const [points, setPoints] = useState<PickupPoint[]>([]);
  const [point, setPoint] = useState("");
  const [pending, setPending] = useState<"search" | "location" | "quote" | null>(null);
  const [nearby, setNearby] = useState(false);
  const [geoPrompt, setGeoPrompt] = useState(false);
  const [mapOpen, setMapOpen] = useState(true);
  const [truncated, setTruncated] = useState(false);
  const [message, setMessage] = useState("");
  const [quote, setQuote] = useState<(DeliveryQuoteView & { phone: string }) | null>(null);
  const [lastPhone, setLastPhone] = useState(phone);
  if (lastPhone !== phone) { setLastPhone(phone); setQuote(null); setMessage(""); }
  const phoneRef = useRef(phone);
  useEffect(() => { phoneRef.current = phone; }, [phone]);
  const revision = useRef(0);
  const searchRequest = useRef<AbortController | null>(null);
  useEffect(() => () => { revision.current++; searchRequest.current?.abort(); }, []);
  function clearQuote() { revision.current++; setQuote(null); onQuote(null); setMessage(""); setPending(null); }
  function selectPoint(id: string) { setPoint(id); clearQuote(); }
  async function search() {
    searchRequest.current?.abort();
    const controller = new AbortController(); searchRequest.current = controller;
    clearQuote(); setPoint(""); setPoints([]); setTruncated(false); setMapOpen(true); setNearby(false); setPending("search");
    const version = revision.current;
    try {
      const response = await fetch(`/api/delivery/ozon/points/?q=${encodeURIComponent(query.trim())}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("points");
      const result = await response.json() as { points: PickupPoint[]; truncated?: boolean };
      if (version !== revision.current) return;
      setPoints(result.points); setTruncated(!!result.truncated);
      if (!result.points.length) setMessage("Пункты не найдены. Уточните город или улицу; если подключение новое, список ПВЗ ещё может обновляться.");
    } catch { if (version === revision.current && !controller.signal.aborted) setMessage("Не удалось загрузить пункты выдачи. Повторите поиск."); }
    finally { if (version === revision.current) setPending(null); }
  }
  async function findNearby() {
    setGeoPrompt(false);
    searchRequest.current?.abort();
    const controller = new AbortController(); searchRequest.current = controller;
    clearQuote(); setPoint(""); setPoints([]); setTruncated(false); setNearby(true); setMapOpen(true);
    if (!navigator.geolocation) { setMessage(geolocationErrorMessage(2)); return; }
    setPending("location"); const version = revision.current;
    try {
      const position = await locateDevice(navigator.geolocation, controller.signal);
      if (version !== revision.current) return;
      const response = await fetch("/api/delivery/ozon/points/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(position), cache: "no-store", signal: controller.signal });
      const result = await response.json() as { points?: PickupPoint[]; truncated?: boolean; error?: string };
      if (version !== revision.current) return;
      if (!response.ok) { setMessage(result.error || "Поиск временно недоступен. Введите город вручную."); return; }
      setPoints(result.points ?? []); setTruncated(!!result.truncated);
      if (!result.points?.length) setMessage("В радиусе 50 км ПВЗ не найдены. Попробуйте поиск по городу или улице.");
    } catch (error) {
      if (version === revision.current && !controller.signal.aborted) setMessage(error && typeof error === "object" && "code" in error ? geolocationErrorMessage(Number(error.code)) : "Не удалось найти ближайшие ПВЗ. Повторите попытку или введите город вручную.");
    } finally { if (version === revision.current) setPending(null); }
  }
  async function calculate() {
    const issue = deliveryCheckIssue(phone, point, consent, packingReady);
    if (issue) { setMessage(issue); return; }
    clearQuote(); setPending("quote"); const version = revision.current; const requestedPhone = phone;
    try {
      const result = await withDeliveryDeadline(quoteOzonDelivery(phone, point, consent));
      if (version !== revision.current || phoneRef.current !== requestedPhone) return;
      if ("token" in result) { const value = result as DeliveryQuoteView; setQuote({ ...value, phone: requestedPhone }); onQuote(value); }
      else setMessage(result.error);
    } catch { if (version === revision.current && phoneRef.current === requestedPhone) setMessage("Проверка временно недоступна. Выберите другую доставку или повторите попытку."); }
    finally { if (version === revision.current) setPending(null); }
  }
  const mapped = points.filter(hasPointCoordinates).length;
  const checkIssue = deliveryCheckIssue(phone, point, consent, packingReady);
  return <div className="ozon-delivery-picker">
    <p className="ozon-free-delivery"><strong>Бесплатная доставка Ozon</strong><span>Расходы на перевозку и страховку оплачивает магазин.</span></p>
    {!packingReady && <p className="notice notice--danger">Для одного из товаров магазин ещё не указал вес и размеры упакованной посылки. Проверка Ozon недоступна — выберите другую доставку или обратитесь в магазин.</p>}
    <p className="muted">Выберите ПВЗ или постамат на карте. Номер получателя должен быть зарегистрирован на Ozon. С вашего согласия передадим его Ozon для проверки доставки и срока получения.</p>
    <div className="ozon-point-search"><label className="field"><span>Город или улица ПВЗ</span><input value={query} maxLength={120} onChange={event => { searchRequest.current?.abort(); setQuery(event.target.value); setPoint(""); setPoints([]); setNearby(false); clearQuote(); }} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); if (!pending && query.trim().length >= 2) void search(); } }} placeholder="Например, Яблоновский" /></label><button type="button" className="button button--outline" onClick={search} disabled={!!pending || query.trim().length < 2}>{pending === "search" ? "Ищем ПВЗ…" : "Найти ПВЗ на карте"}</button></div>
    <button type="button" className="button button--outline button--small" onClick={() => setGeoPrompt(true)} disabled={!!pending}>ПВЗ рядом со мной</button>
    {geoPrompt && <div className="notice ozon-geolocation-prompt" role="region" aria-label="Разрешение поиска по геопозиции"><strong>Найти ПВЗ по местоположению?</strong><p>Разрешаете использовать геопозицию для разового поиска? Браузер запросит доступ. Округлённые координаты будут переданы только серверу магазина в России, не сохраняются и не передаются Ozon. Можно отказаться и ввести город вручную. <Link className="text-link" href="/legal/privacy/" target="_blank">Подробнее</Link></p><div><button type="button" className="button button--small" onClick={findNearby}>Разрешить и найти ПВЗ</button><button type="button" className="text-link" onClick={() => setGeoPrompt(false)}>Отмена</button></div></div>}
    {pending && <p className="notice" role="status" aria-live="polite">{pending === "location" ? "Определяем местоположение и ищем ближайшие ПВЗ… Если браузер запросил доступ, разрешите его или воспользуйтесь ручным поиском." : pending === "quote" ? "Проверяем доступность ПВЗ и срок доставки в Ozon…" : "Загружаем пункты выдачи…"}{pending !== "quote" && <button type="button" className="text-link" onClick={() => { searchRequest.current?.abort(); clearQuote(); }}>Отменить поиск</button>}</p>}
    {!!points.length && <>
      <div className="ozon-map-toolbar"><span>{nearby ? "Ближайшие ПВЗ: " : "Найдено ПВЗ: "}{points.length}{truncated ? "+" : ""}</span>{mapped > 0 && <button type="button" className="text-link" aria-expanded={mapOpen} onClick={() => setMapOpen(!mapOpen)}>{mapOpen ? "Скрыть карту" : "Открыть карту"}</button>}</div>
      {mapOpen && mapped > 0 && <PickupMap points={points} selected={point} onSelect={selectPoint} />}
      {mapped < points.length && <p className="muted">{mapped === 0 ? "Координаты пока недоступны. Выберите ПВЗ из списка." : "Пункты без координат доступны в списке адресов."}</p>}
      {nearby && <p className="muted">По расстоянию от примерной геопозиции, по прямой, в пределах 50 км. Проверьте адрес перед выбором.{truncated ? " Показаны 60 ближайших пунктов." : ""}</p>}
      {truncated && !nearby && <p className="muted">Показаны первые 200 пунктов. Уточните улицу, чтобы найти нужный ПВЗ.</p>}
      <label className="field"><span>Пункт выдачи — можно выбрать на карте или в списке</span><select value={point} onChange={event => selectPoint(event.target.value)}><option value="">Выберите пункт выдачи</option>{points.map(value => <option key={value.id} value={value.id}>{value.distanceKm !== undefined ? `≈ ${value.distanceKm} км · ` : ""}{value.address}{value.type === "postamat" ? " · постамат" : ""}</option>)}</select></label>
    </>}
    {point && <p className="notice">Выбран ПВЗ: {points.find(value => value.id === point)?.address}</p>}
    <label className="checkout-consent"><input type="checkbox" name="ozonConsent" checked={consent} required onChange={event => { setConsent(event.target.checked); clearQuote(); }} /><span>Даю отдельное <Link href="/legal/consent/?purpose=ozon" target="_blank">согласие на передачу номера Ozon для проверки и расчёта доставки</Link>. Без согласия можно выбрать другой способ доставки.</span></label>
    {checkIssue && message !== checkIssue && <p className="notice ozon-check-help" id="ozon-check-help">{checkIssue}</p>}
    <button type="button" className="button button--small" onClick={calculate} disabled={!!pending} aria-describedby={message ? "ozon-check-message" : checkIssue ? "ozon-check-help" : undefined}>{pending === "quote" ? "Проверяем доставку…" : "Проверить доставку в выбранный ПВЗ"}</button>
    {message && <p className="notice" role="alert" id="ozon-check-message">{message}</p>}
    {quote && quote.phone === phone && <p className="notice notice--success" role="status"><strong>Доставка бесплатная · 0 ₽</strong><br />{quote.address}<br />Примерно {quote.days} дн. в пути после отгрузки. Проверка действительна 15 минут.</p>}
  </div>;
}
