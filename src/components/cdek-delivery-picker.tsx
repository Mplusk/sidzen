"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cdekCalculate, cdekCities, cdekPoints } from "@/app/actions/cdek-delivery";
import { formatPrice } from "@/lib/format";
import { PickupPointDialog } from "@/components/pickup-point-dialog";

type City = { code: number; full_name: string };
type Point = { id: string; name: string; address: string; type: string; workTime: string; latitude: number | null; longitude: number | null };
export type CdekQuoteView = { token: string; cost: number; daysMin: number; daysMax: number; name: string };

export function CdekDeliveryPicker({ onQuote }: { onQuote: (quote: CdekQuoteView | null) => void }) {
  const id = useId();
  const generation = useRef(0);
  const tariffRef = useRef<HTMLFieldSetElement>(null);
  const [query, setQuery] = useState("");
  const [cities, setCities] = useState<City[]>([]);
  const [activeCity, setActiveCity] = useState(-1);
  const [city, setCity] = useState<City | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [filter, setFilter] = useState("");
  const [point, setPoint] = useState("");
  const [rates, setRates] = useState<CdekQuoteView[]>([]);
  const [selected, setSelected] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const filtered = useMemo(() => points.filter(value => value.address.toLocaleLowerCase("ru").includes(filter.toLocaleLowerCase("ru"))), [points, filter]);
  const mapPoints = useMemo(() => filtered.slice(0, 250), [filtered]);
  useEffect(() => {
    if (!rates.length) return;
    tariffRef.current?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [rates]);
  useEffect(() => {
    if (city || query.trim().length < 2) return;
    const version = ++generation.current;
    const timer = setTimeout(() => { setBusy(true); void cdekCities(query).then(result => {
      if (generation.current !== version) return;
      setCities(result.cities ?? []); setActiveCity(-1); setMessage(result.error ?? (!result.cities?.length ? "Город не найден. Проверьте написание." : "")); setBusy(false);
    }).catch(() => { if (generation.current === version) { setMessage("Не удалось загрузить города."); setBusy(false); } }); }, 350);
    return () => { clearTimeout(timer); };
  }, [query, city]);
  async function selectCity(value: City) {
    const version = ++generation.current; setMapOpen(false); setCity(value); setQuery(value.full_name); setCities([]); setPoints([]); setPoint(""); setRates([]); setSelected(""); onQuote(null); setBusy(true); setMessage("");
    try {
      const result = await cdekPoints(value.code);
      if (generation.current !== version) return;
      setPoints(result.points ?? []); setMessage(result.error ?? (result.truncated ? "Показана часть пунктов. Уточните город." : !result.points?.length ? "Пункты выдачи не найдены." : ""));
    } catch { if (generation.current === version) setMessage("Не удалось загрузить пункты выдачи."); }
    finally { if (generation.current === version) setBusy(false); }
  }
  async function selectPoint(value: string) {
    if (!city) return;
    const version = ++generation.current; setMapOpen(false); setPoint(value); setRates([]); setSelected(""); onQuote(null); setBusy(true); setMessage("");
    try {
      const result = await cdekCalculate(city.code, value);
      if (generation.current !== version) return;
      setRates(result.rates ?? []); setMessage(result.error ?? (!result.rates?.length ? "Для этого пункта тарифы недоступны." : "Выберите тариф доставки."));
    } catch { if (generation.current === version) setMessage("Не удалось рассчитать доставку."); }
    finally { if (generation.current === version) setBusy(false); }
  }
  return <div className="ozon-delivery-picker">
    <p><strong>Доставка СДЭК в пункт выдачи</strong><br />Стоимость оплачивает покупатель.</p>
    <div className="ozon-search-field"><label className="field" htmlFor={id}><span>Город получения</span><input id={id} role="combobox" value={query} maxLength={100} autoComplete="off" aria-autocomplete="list" aria-expanded={!!cities.length && !city} aria-controls={`${id}-cities`} aria-activedescendant={activeCity >= 0 ? `${id}-city-${activeCity}` : undefined} onChange={event => { generation.current++; setMapOpen(false); setCity(null); setQuery(event.target.value); setCities([]); setActiveCity(-1); setPoints([]); setPoint(""); setRates([]); setSelected(""); onQuote(null); setBusy(false); setMessage(""); }} onKeyDown={event => { if (event.nativeEvent.isComposing) return; if (event.key === "Escape") { setCities([]); setActiveCity(-1); } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && cities.length) { event.preventDefault(); setActiveCity(index => event.key === "ArrowDown" ? (index + 1) % cities.length : (index <= 0 ? cities.length - 1 : index - 1)); } else if (event.key === "Enter" && activeCity >= 0 && cities[activeCity]) { event.preventDefault(); void selectCity(cities[activeCity]); } }} placeholder="Начните вводить город" /></label>
    {!!cities.length && !city && <div className="ozon-search-popover" id={`${id}-cities`} role="listbox" aria-label="Подсказки городов">{cities.map((value, index) => <button id={`${id}-city-${index}`} key={value.code} type="button" role="option" aria-selected={activeCity === index} className="ozon-search-option" onClick={() => void selectCity(value)}>{value.full_name}</button>)}</div>}</div>
    {busy && <p role="status">Загружаем данные СДЭК…</p>}
    {city && !!points.length && <><label className="field">Поиск улицы<input value={filter} onChange={event => setFilter(event.target.value)} placeholder="Название улицы или адрес" /></label>{!!filtered.length && <div className="ozon-map-toolbar"><button type="button" className="text-link" aria-haspopup="dialog" onClick={() => setMapOpen(true)}>{point ? "Изменить на карте" : "Выбрать на карте"}</button></div>}{mapOpen && !!mapPoints.length && <PickupPointDialog carrier="СДЭК" points={mapPoints} selected={point} onSelect={value => void selectPoint(value)} onClose={() => setMapOpen(false)} />}{filtered.length > mapPoints.length && <p className="muted">На карте показаны первые {mapPoints.length} пунктов. Уточните улицу или выберите любой адрес в списке.</p>}<label className="field">Пункт выдачи<select value={point} onChange={event => void selectPoint(event.target.value)}><option value="">Выберите ПВЗ</option>{filtered.map(value => <option key={value.id} value={value.id}>{value.address}{value.workTime ? ` · ${value.workTime}` : ""}</option>)}</select></label></>}
    {!!rates.length && <fieldset ref={tariffRef}><legend>Тариф СДЭК</legend>{rates.map(rate => <label className="delivery-option" key={rate.token}><input type="radio" checked={selected === rate.token} onChange={() => { setSelected(rate.token); onQuote(rate); }} /><span><strong>{rate.name}</strong><small>{rate.daysMin}–{rate.daysMax} дн. после отгрузки</small></span><strong>{formatPrice(rate.cost)}</strong></label>)}</fieldset>}
    {message && <p className="notice" role="status">{message}</p>}
  </div>;
}
