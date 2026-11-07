"use client";

import { useId, useRef, useState, useEffect } from "react";
import type { PickupPoint } from "@/lib/delivery/points";

type Results = { points: PickupPoint[]; truncated?: boolean };
export function OzonPointSearch({ onReset, onResults, onSelect, onOpenMap }: {
  onReset: () => void;
  onResults: (points: PickupPoint[], truncated: boolean) => void;
  onSelect: (id: string) => void;
  onOpenMap?: () => void;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Results | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [searchingMap, setSearchingMap] = useState(false);
  const [message, setMessage] = useState("");
  const request = useRef<AbortController | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generation = useRef(0);
  const list = useRef<HTMLDivElement>(null);
  function cancel() {
    generation.current++;
    request.current?.abort();
    if (debounce.current !== null) clearTimeout(debounce.current);
    debounce.current = null;
  }
  useEffect(() => () => {
    generation.current++;
    request.current?.abort();
    if (debounce.current !== null) clearTimeout(debounce.current);
  }, []);
  async function load(value: string, mode: "suggest" | "map") {
    cancel();
    const version = generation.current;
    const controller = new AbortController(); request.current = controller;
    const deadline = setTimeout(() => controller.abort(), 15000);
    if (mode === "map") onReset();
    setBusy(true); setSearchingMap(mode === "map"); setMessage("");
    try {
      const response = await fetch(`/api/delivery/ozon/points/?q=${encodeURIComponent(value.trim())}${mode === "suggest" ? "&view=suggest" : ""}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 429 ? "rate-limit" : "points");
      const result = await response.json() as Results;
      if (version !== generation.current) return;
      if (mode === "suggest") { setSuggestions(result); setActive(-1); }
      else { setOpen(false); onResults(result.points, !!result.truncated); if (result.points.length) onOpenMap?.(); }
      if (!result.points.length) setMessage("ПВЗ не найдены. Попробуйте название города и часть улицы, например «Омск Бульвар». Проверьте написание.");
    } catch (error) {
      if (version !== generation.current) return;
      setMessage(error instanceof Error && error.message === "rate-limit" ? "Слишком много запросов. Подождите немного и повторите поиск." : "Не удалось загрузить адреса. Нажмите «Найти ПВЗ на карте», чтобы повторить поиск.");
    } finally {
      clearTimeout(deadline);
      if (version === generation.current) { setBusy(false); setSearchingMap(false); request.current = null; }
    }
  }
  function change(value: string) {
    cancel(); setQuery(value); setSuggestions(null); setActive(-1); setSearchingMap(false); setMessage(""); onReset();
    const ready = value.trim().length >= 2;
    setOpen(ready); setBusy(ready);
    if (ready) debounce.current = setTimeout(() => { debounce.current = null; void load(value, "suggest"); }, 300);
  }
  function choose(point: PickupPoint) {
    // Keep the user's short search, not a long official address exceeding the input limit.
    cancel(); setBusy(false); setSearchingMap(false); setOpen(false); setActive(-1); setMessage("");
    onResults(suggestions?.points || [point], !!suggestions?.truncated); onSelect(point.id);
  }
  const options = suggestions?.points || [];
  const expanded = open && (busy || !!suggestions || !!message);
  return <div className="ozon-search" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <div className="ozon-point-search">
      <div className="ozon-search-field">
        <label className="field" htmlFor={id}><span>Город или улица ПВЗ</span></label>
        <input id={id} role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls={expanded ? `${id}-list` : undefined} aria-activedescendant={expanded && active >= 0 ? `${id}-option-${active}` : undefined} aria-describedby={`${id}-help ${id}-status`} autoComplete="off" value={query} maxLength={120}
          onChange={event => change(event.target.value)}
          onFocus={() => { if (query.trim().length >= 2 && (suggestions || busy || message)) setOpen(true); }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape") { event.preventDefault(); setOpen(false); setActive(-1); }
            if ((event.key === "ArrowDown" || event.key === "ArrowUp") && options.length) {
              event.preventDefault(); setOpen(true);
              const next = event.key === "ArrowDown" ? (active + 1) % options.length : (active <= 0 ? options.length - 1 : active - 1);
              setActive(next); list.current?.querySelectorAll('[role="option"]')[next]?.scrollIntoView({ block: "nearest" });
            }
            if (event.key === "Enter") {
              event.preventDefault();
              if (expanded && active >= 0 && options[active]) choose(options[active]);
              else if (query.trim().length >= 2) void load(query, "map");
            }
            if (event.key === "Tab") setOpen(false);
          }} placeholder="Например, Омск Бульварная" />
        {expanded && <div className="ozon-search-popover">
          <div ref={list} id={`${id}-list`} role="listbox" aria-label="Подсказки адресов ПВЗ" aria-busy={busy}>
            {!busy && options.map((point, index) => <button key={point.id} id={`${id}-option-${index}`} type="button" role="option" aria-selected={active === index} tabIndex={-1} className="ozon-search-option" onPointerDown={event => event.preventDefault()} onClick={() => choose(point)}>
              <span className="ozon-search-option__icon" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2.5" /></svg></span><span><strong>{point.address}</strong><small>{point.type === "postamat" ? "Постамат Ozon" : "Пункт выдачи Ozon"} · Выбрать</small></span>
            </button>)}
          </div>
          <div className="ozon-search-caption"><p>{busy ? "Ищем подходящие адреса…" : message || (suggestions?.truncated ? "Первые 8 адресов. Можно уточнить улицу." : "Выберите адрес — перейдём к телефону.")}</p>
            {!busy && !message && !!options.length && <button type="button" className="ozon-search-map-link" onClick={() => void load(query, "map")}>Все ПВЗ на карте →</button>}
          </div>
        </div>}
      </div>
      <button type="button" className="button button--outline" onClick={() => void load(query, "map")} disabled={searchingMap || query.trim().length < 2} aria-busy={searchingMap}>{searchingMap ? "Ищем ПВЗ…" : "Найти ПВЗ на карте"}</button>
    </div>
    <p className="ozon-search-help muted" id={`${id}-help`}>Введите от двух букв. Можно писать город и часть улицы в любом порядке.</p>
    <p id={`${id}-status`} className="sr-only" role="status">{busy ? "Ищем подходящие адреса…" : message || (open && suggestions ? `Найдено подсказок: ${options.length}. Стрелки — выбор, Enter — подтвердить.` : "")}</p>
    {!expanded && message && <p className="notice" role="alert">{message}</p>}
  </div>;
}
