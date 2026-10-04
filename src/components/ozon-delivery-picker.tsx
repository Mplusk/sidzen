"use client";

import { useEffect, useRef, useState } from "react";
import { quoteOzonDelivery } from "@/app/actions/ozon-delivery";
import { formatPrice } from "@/lib/format";
import Link from "next/link";

export type DeliveryQuoteView = { token: string; cost: number; days: number; address: string };
type Point = { id: string; name: string; address: string; type: string };
export function OzonDeliveryPicker({ phone, onQuote, packingReady = true }: { phone: string; onQuote: (value: DeliveryQuoteView | null) => void; packingReady?: boolean }) {
  const [consent, setConsent] = useState(false);
  const [query, setQuery] = useState(""); const [points, setPoints] = useState<Point[]>([]);
  const [point, setPoint] = useState(""); const [pending, setPending] = useState(false);
  const [message, setMessage] = useState(""); const [quote, setQuote] = useState<DeliveryQuoteView | null>(null);
  const revision = useRef(0);
  useEffect(() => () => { revision.current++; }, []);
  function clearQuote() { revision.current++; setQuote(null); onQuote(null); setMessage(""); }
  async function search() {
    clearQuote(); setPoint(""); setPoints([]); setPending(true); const version = revision.current;
    try {
      const response = await fetch(`/api/delivery/ozon/points/?q=${encodeURIComponent(query.trim())}`, { cache: "no-store" });
      if (!response.ok) throw new Error("points");
      const result = await response.json() as { points: Point[] };
      if (version !== revision.current) return;
      setPoints(result.points); if (!result.points.length) setMessage("Пункты не найдены. Уточните город или улицу; если подключение новое, список ПВЗ ещё может обновляться.");
    } catch { if (version === revision.current) setMessage("Не удалось загрузить пункты выдачи. Повторите поиск."); }
    finally { setPending(false); }
  }
  async function calculate() {
    clearQuote(); setPending(true); const version = revision.current;
    try {
      const result = await quoteOzonDelivery(phone, point, consent);
      if (version !== revision.current) return;
      if ("token" in result) { const value = result as DeliveryQuoteView; setQuote(value); onQuote(value); }
      else setMessage(result.error);
    } catch { if (version === revision.current) setMessage("Расчёт временно недоступен. Выберите другую доставку или повторите попытку."); }
    finally { setPending(false); }
  }
  return <div className="ozon-delivery-picker">
    {!packingReady && <p className="notice notice--danger">Для одного из товаров магазин ещё не указал вес и размеры упакованной посылки. Расчёт Ozon недоступен — выберите другую доставку или обратитесь в магазин.</p>}
    <p className="muted">Получение в ПВЗ или постамате Ozon. Номер получателя должен быть зарегистрирован на Ozon. Для расчёта передадим Ozon этот номер и параметры посылок.</p>
    <div className="ozon-point-search"><label className="field"><span>Город или улица ПВЗ</span><input value={query} maxLength={120} onChange={event => { setQuery(event.target.value); setPoint(""); setPoints([]); clearQuote(); }} placeholder="Москва, Тверская" /></label><button type="button" className="button button--outline" onClick={search} disabled={pending || query.trim().length < 2}>{pending ? "Подождите…" : "Найти ПВЗ"}</button></div>
    {!!points.length && <label className="field"><span>Пункт выдачи</span><select value={point} onChange={event => { setPoint(event.target.value); clearQuote(); }}><option value="">Выберите пункт из списка</option>{points.map(value => <option key={value.id} value={value.id}>{value.address}{value.type === "postamat" ? " · постамат" : ""}</option>)}</select></label>}
    {point && <p className="notice">Выбран ПВЗ: {points.find(value => value.id === point)?.address}</p>}
    <label className="checkout-consent"><input type="checkbox" name="ozonConsent" checked={consent} required onChange={event => { setConsent(event.target.checked); clearQuote(); }} /><span>Даю отдельное <Link href="/legal/consent/?purpose=ozon" target="_blank">согласие на передачу номера Ozon для расчёта доставки</Link>. Без согласия можно выбрать другой способ доставки.</span></label>
    <button type="button" className="button button--small" onClick={calculate} disabled={pending || !packingReady || !consent || !point || phone.replace(/\D/g, "").length !== 11}>Рассчитать доставку Ozon</button>
    {message && <p className="notice" role="alert">{message}</p>}
    {quote && <p className="notice notice--success" role="status"><strong>{formatPrice(quote.cost)}, включая страховку</strong><br />{quote.address}<br />Примерно {quote.days} дн. в пути после отгрузки. Расчёт действителен 15 минут и перепроверяется при оформлении.</p>}
  </div>;
}
