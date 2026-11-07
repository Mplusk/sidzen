"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { PickupPoint } from "@/lib/delivery/points";

type Results = { points: PickupPoint[]; truncated?: boolean };

export function OzonPointSearch({ onReset, onResults, onOpenMap }: {
  onReset: () => void;
  onResults: (points: PickupPoint[], truncated: boolean) => void;
  onOpenMap: () => void;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [cities, setCities] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [suggesting, setSuggesting] = useState(false);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const suggestRequest = useRef<AbortController | null>(null);
  const suggestGeneration = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function cancelSuggestions() {
    suggestGeneration.current++;
    suggestRequest.current?.abort();
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }

  function cancel() {
    generation.current++;
    request.current?.abort();
    request.current = null;
  }
  useEffect(() => () => { generation.current++; request.current?.abort(); cancelSuggestions(); }, []);

  function change(value: string) {
    cancel(); cancelSuggestions(); setBusy(false); setQuery(value); setMessage(""); setCities([]); setActive(-1); onReset();
    const ready = value.trim().length >= 2;
    setOpen(ready); setSuggesting(ready);
    if (!ready) return;
    const version = suggestGeneration.current;
    timer.current = setTimeout(async () => {
      timer.current = null;
      const controller = new AbortController(); suggestRequest.current = controller;
      const deadline = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(`/api/delivery/ozon/points/?q=${encodeURIComponent(value.trim())}&view=cities`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("cities");
        const data = await response.json() as { cities: string[] };
        if (version === suggestGeneration.current) setCities(data.cities);
      } catch { /* Manual city search remains available. */ }
      finally {
        clearTimeout(deadline);
        if (version === suggestGeneration.current) { setSuggesting(false); suggestRequest.current = null; }
      }
    }, 300);
  }
  function choose(city: string) {
    cancelSuggestions(); setSuggesting(false); setQuery(city); setCities([]); setOpen(false); setActive(-1); setMessage(""); onReset();
  }

  async function search() {
    if (query.trim().length < 2 || busy) return;
    cancelSuggestions(); setSuggesting(false); setOpen(false); setActive(-1);
    cancel();
    const version = generation.current;
    const controller = new AbortController();
    request.current = controller;
    const deadline = setTimeout(() => controller.abort(), 15000);
    onReset(); setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/delivery/ozon/points/?q=${encodeURIComponent(query.trim())}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 429 ? "rate-limit" : "points");
      const result = await response.json() as Results;
      if (version !== generation.current) return;
      onResults(result.points, !!result.truncated);
      if (result.points.length) onOpenMap();
      else setMessage("Пункты выдачи не найдены. Проверьте название города и попробуйте ещё раз.");
    } catch (error) {
      if (version !== generation.current) return;
      setMessage(error instanceof Error && error.message === "rate-limit" ? "Слишком много запросов. Подождите немного и повторите поиск." : "Не удалось загрузить пункты. Нажмите «Найти ПВЗ на карте», чтобы повторить поиск.");
    } finally {
      clearTimeout(deadline);
      if (version === generation.current) { setBusy(false); request.current = null; }
    }
  }

  return <div className="ozon-search" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <div className="ozon-point-search">
      <div className="ozon-search-field">
        <label className="field" htmlFor={id}><span>Город</span></label>
        <input id={id} role="combobox" aria-autocomplete="list" aria-expanded={open && cities.length > 0} aria-controls={open && cities.length ? `${id}-list` : undefined} aria-activedescendant={open && active >= 0 ? `${id}-option-${active}` : undefined} aria-describedby={`${id}-help ${id}-status`} autoComplete="off" value={query} maxLength={120}
          onChange={event => change(event.target.value)}
          onFocus={() => { if (cities.length) setOpen(true); }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape") { setOpen(false); setActive(-1); }
            if ((event.key === "ArrowDown" || event.key === "ArrowUp") && cities.length) {
              event.preventDefault(); setOpen(true);
              setActive(event.key === "ArrowDown" ? (active + 1) % cities.length : (active <= 0 ? cities.length - 1 : active - 1));
            }
            if (event.key === "Enter") {
              event.preventDefault();
              if (open && active >= 0 && cities[active]) choose(cities[active]);
              else void search();
            }
          }}
          placeholder="Например, Омск" />
        {open && cities.length > 0 && <div className="ozon-search-popover">
          <div id={`${id}-list`} role="listbox" aria-label="Варианты города">
            {cities.map((city, index) => <button key={city} id={`${id}-option-${index}`} type="button" role="option" aria-selected={active === index} tabIndex={-1} className="ozon-search-option" onPointerDown={event => event.preventDefault()} onClick={() => choose(city)}><strong>{city}</strong></button>)}
          </div>
        </div>}
      </div>
      <button type="button" className="button button--outline" onClick={() => void search()} disabled={busy || query.trim().length < 2} aria-busy={busy}>{busy ? "Ищем ПВЗ…" : "Найти ПВЗ на карте"}</button>
    </div>
    <p className="ozon-search-help muted" id={`${id}-help`}>Введите не менее двух букв.</p>
    <p className="sr-only" id={`${id}-status`} role="status">{suggesting ? "Ищем города…" : open && cities.length ? `Вариантов города: ${cities.length}. Используйте стрелки и Enter для выбора.` : ""}</p>
    {message && <p className="notice" role="alert">{message}</p>}
  </div>;
}
