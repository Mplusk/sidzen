"use client";

import { useEffect, useRef, useState } from "react";
import { quoteFivePostPoint } from "@/app/actions/fivepost-delivery";
import { PickupPointDialog } from "./pickup-point-dialog";
import type { PickupMapCity } from "@/lib/delivery/point-viewport";

type City = { city: string; region: string };
type Point = { id: string; name: string; address: string };
export type FivePostQuoteView = { address: string; token: string; price: number; days: number | null };
const endpoint = "/api/delivery/fivepost/points/";

export function FivePostDeliveryPicker({ onQuote }: { onQuote: (quote: FivePostQuoteView | null) => void }) {
  const [query, setQuery] = useState("");
  const [city, setCity] = useState<City | null>(null);
  const [cities, setCities] = useState<City[]>([]);
  const [street, setStreet] = useState("");
  const [points, setPoints] = useState<Point[]>([]);
  const [map, setMap] = useState<PickupMapCity | null>(null);
  const [chosen, setChosen] = useState<Point | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const revision = useRef(0);
  useEffect(() => () => { revision.current++; }, []);
  useEffect(() => {
    if (!city && query.trim().length < 2) return;
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = city ? { view: "addresses", q: city.city, region: city.region, street } : { view: "cities", q: query };
        const response = await fetch(endpoint + "?" + new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined)), { signal: abort.signal });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (abort.signal.aborted) return;
        if (city) setPoints(data.points); else setCities(data.cities);
        if (!(city ? data.points : data.cities).length) setMessage(city ? "По этому адресу пунктов не найдено." : "В этом городе пока нет пунктов 5Post.");
      } catch { if (!abort.signal.aborted) setMessage("Не удалось загрузить пункты 5Post. Повторите поиск."); }
    }, 70);
    return () => { abort.abort(); clearTimeout(timer); };
  }, [query, city, street]);
  function clearChoice() {
    revision.current++;
    setChosen(null); setMessage(""); setBusy(false); setMap(null); onQuote(null);
  }
  async function openMap() {
    if (!city) return;
    const version = ++revision.current;
    setBusy(true); setMessage("");
    try {
      const params = new URLSearchParams({ view: "city", q: city.city, region: city.region });
      const response = await fetch(endpoint + "?" + params);
      if (!response.ok) throw new Error();
      const { city: center } = await response.json();
      if (version !== revision.current) return;
      if (!center) throw new Error();
      setMap(center);
    } catch { if (version === revision.current) setMessage("Карта недоступна. Выберите пункт по адресу."); }
    finally { if (version === revision.current) setBusy(false); }
  }
  async function select(point: Point) {
    const version = ++revision.current;
    setMap(null); setBusy(true); setMessage(""); setChosen(null); onQuote(null);
    try {
      const result = await quoteFivePostPoint(point.id);
      if (version !== revision.current) return;
      if (!result.quote) { setMessage(result.error ?? "Выберите другой пункт."); return; }
      setChosen(point); onQuote(result.quote);
    } catch { if (version === revision.current) setMessage("Не удалось проверить пункт. Попробуйте ещё раз."); }
    finally { if (version === revision.current) setBusy(false); }
  }
  return <div className="ozon-delivery-picker">
    <label className="field">Город получения<input value={query} maxLength={120} autoComplete="off" placeholder="Начните вводить город" onChange={e => { clearChoice(); setQuery(e.target.value); setCity(null); setCities([]); setStreet(""); setPoints([]); }} /></label>
    {!city && !!cities.length && <ul className="plain-list" aria-label="Найденные города">{cities.map(value => <li key={JSON.stringify(value)}><button type="button" className="text-link" onClick={() => { clearChoice(); setCity(value); setQuery(value.city); setCities([]); }}>{value.city}{value.region && ` · ${value.region}`}</button></li>)}</ul>}
    {city && <><button type="button" className="button button--secondary" aria-haspopup="dialog" disabled={busy} onClick={openMap}>Выбрать на карте</button>
      <label className="field">Улица или адрес<input value={street} maxLength={150} onChange={e => { clearChoice(); setStreet(e.target.value); setPoints([]); }} /></label>
      <label className="field">Пункт выдачи<select value={chosen?.id ?? ""} disabled={busy} onChange={e => { const point = points.find(value => value.id === e.target.value); if (point) void select(point); else clearChoice(); }}><option value="">Выберите адрес</option>
        {chosen && !points.some(p => p.id === chosen.id) && <option value={chosen.id}>{chosen.address}</option>}
        {points.map(p => <option key={p.id} value={p.id}>{p.address}</option>)}</select></label></>}
    {map && <PickupPointDialog carrier="5Post" city={map} selected={chosen?.id ?? ""} onSelect={(_, p) => void select(p)} onClose={() => setMap(null)} />}
    {busy && <p role="status">Загружаем данные 5Post…</p>}
    {message && <p className="notice" role="status">{message}</p>}
  </div>;
}
