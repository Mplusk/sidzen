"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { PickupMapCity } from "@/lib/delivery/point-viewport";
import { prepareCityNames, rankPreparedCities, type PreparedCity } from "@/lib/delivery/city-suggestions";
import styles from "./ozon-point-search.module.css";

type Results = { city: PickupMapCity | null; scope?: string };

export function OzonPointSearch({ onReset, onCity, renderAction, actionLabel = "Выбрать на карте", onOpen }: {
  onReset: () => void;
  onCity: (city: PickupMapCity) => void;
  renderAction?: (button: ReactNode) => ReactNode;
  actionLabel?: string;
  onOpen?: () => void;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [cities, setCities] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestionsUnavailable, setSuggestionsUnavailable] = useState(false);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const suggestRequest = useRef<AbortController | null>(null);
  const suggestGeneration = useRef(0);
  const directory = useRef<PreparedCity[] | null>(null);
  const suggestionQuery = useRef<string | null>(null);
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
  useEffect(() => {
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 15000);
    let mounted = true;
    // Start while the buyer fills the rest of checkout, not after typing.
    void fetch("/api/delivery/ozon/points/?view=directory", { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("directory");
        const data = await response.json() as { cities?: unknown };
        if (!Array.isArray(data.cities) || !data.cities.every(city => typeof city === "string")) throw new Error("directory");
        return prepareCityNames(data.cities);
      })
      .then(cities => {
        if (!mounted) return;
        directory.current = cities;
        if (suggestionQuery.current !== null) {
          cancelSuggestions();
          setCities(rankPreparedCities(suggestionQuery.current, cities));
          setSuggesting(false); setSuggestionsUnavailable(false);
        }
      })
      .catch(() => { /* The per-query search remains available if preloading fails. */ })
      .finally(() => clearTimeout(deadline));
    return () => { mounted = false; clearTimeout(deadline); controller.abort(); };
  }, []);

  function change(value: string) {
    cancel(); cancelSuggestions(); setBusy(false); setQuery(value); setMessage(""); setCities([]); setActive(-1); setSuggestionsUnavailable(false); onReset();
    const ready = value.trim().length >= 2;
    suggestionQuery.current = ready ? value.trim() : null;
    setOpen(ready);
    if (ready && directory.current) {
      setCities(rankPreparedCities(value, directory.current)); setSuggesting(false);
      return;
    }
    setSuggesting(ready);
    if (!ready) return;
    const version = suggestGeneration.current;
    timer.current = setTimeout(async () => {
      timer.current = null;
      const controller = new AbortController(); suggestRequest.current = controller;
      const deadline = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(`/api/delivery/ozon/points/?q=${encodeURIComponent(value.trim())}&view=cities`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("cities");
        const data = await response.json() as { cities: string[]; suggestionsUnavailable?: boolean };
        if (!Array.isArray(data.cities)) throw new Error("cities");
        if (version === suggestGeneration.current) { setCities(data.cities); setSuggestionsUnavailable(!!data.suggestionsUnavailable); }
      } catch { if (version === suggestGeneration.current) setSuggestionsUnavailable(true); }
      finally {
        clearTimeout(deadline);
        if (version === suggestGeneration.current) { setSuggesting(false); suggestRequest.current = null; }
      }
    }, 100);
  }
  function choose(city: string) {
    cancel(); setBusy(false);
    suggestionQuery.current = null;
    cancelSuggestions(); setSuggesting(false); setSuggestionsUnavailable(false); setQuery(city); setCities([]); setOpen(false); setActive(-1); setMessage(""); onReset();
  }

  async function search() {
    if (query.trim().length < 2 || busy) return;
    suggestionQuery.current = null;
    cancelSuggestions(); setSuggesting(false); setOpen(false); setActive(-1);
    cancel();
    const version = generation.current;
    const controller = new AbortController();
    request.current = controller;
    onReset(); setBusy(true); setMessage("");
    try {
      // The opening request contains only the city's camera bounds. Addresses
      // are requested by the map after it is visible, never as a city-wide list.
      const deadline = setTimeout(() => controller.abort(), 15000);
      let result: Results;
      try {
        const response = await fetch(`/api/delivery/ozon/points/?q=${encodeURIComponent(query.trim())}&view=city`, { cache: "no-cache", signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 429 ? "rate-limit" : "points");
        result = await response.json() as Results;
      } finally { clearTimeout(deadline); }
      if (version !== generation.current) return;
      if (controller.signal.aborted) throw new Error("timeout");
      if (result.city) { setQuery(result.city.name); onCity(result.city); }
      else {
        // The user may submit before the debounced suggestions arrive. Offer
        // corrections again, without silently changing the requested city.
        setMessage("Пункты выдачи не найдены. Проверьте название города и попробуйте ещё раз.");
        const deadline = setTimeout(() => controller.abort(), 10000);
        try {
          const response = await fetch(`/api/delivery/ozon/points/?q=${encodeURIComponent(query.trim())}&view=cities`, { cache: "no-store", signal: controller.signal });
          if (!response.ok) throw new Error("cities");
          const data = await response.json() as { cities: string[]; suggestionsUnavailable?: boolean };
          if (!Array.isArray(data.cities)) throw new Error("cities");
          if (version !== generation.current) return;
          setCities(data.cities); setSuggestionsUnavailable(!!data.suggestionsUnavailable);
          if (data.cities.length) { setOpen(true); setActive(-1); setMessage("Пункты выдачи не найдены. Выберите подходящий город из подсказок."); }
        } catch {
          if (version === generation.current) setSuggestionsUnavailable(true);
        } finally { clearTimeout(deadline); }
      }
    } catch (error) {
      if (version !== generation.current) return;
      setMessage(error instanceof Error && error.message === "rate-limit" ? "Слишком много запросов. Подождите немного и повторите поиск." : "Не удалось открыть карту. Попробуйте ещё раз.");
    } finally {
      if (version === generation.current) { setBusy(false); request.current = null; }
    }
  }

  return <div className="ozon-search" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <div className={`ozon-point-search ${renderAction ? styles.compact : ""}`}>
      <div className="ozon-search-field">
        <label className="field" htmlFor={id}><span>Город</span></label>
        <input ref={input} className={styles.input} id={id} role="combobox" aria-autocomplete="list" aria-expanded={open && cities.length > 0} aria-controls={open && cities.length ? `${id}-list` : undefined} aria-activedescendant={open && active >= 0 ? `${id}-option-${active}` : undefined} aria-describedby={`${id}-help ${id}-status`} autoComplete="off" value={query} maxLength={120}
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
        {query && <button type="button" className={styles.clear} aria-label="Очистить город" onClick={() => { change(""); input.current?.focus(); }}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m6 6 12 12M18 6 6 18" /></svg></button>}
        {open && cities.length > 0 && <div className="ozon-search-popover">
          <div id={`${id}-list`} role="listbox" aria-label="Варианты города">
            {cities.map((city, index) => <button key={city} id={`${id}-option-${index}`} type="button" role="option" aria-selected={active === index} tabIndex={-1} className="ozon-search-option" onPointerDown={event => event.preventDefault()} onClick={() => choose(city)}><strong>{city}</strong></button>)}
          </div>
        </div>}
      </div>
      {!renderAction && <button type="button" className="button button--outline" onClick={() => void search()} disabled={busy || query.trim().length < 2} aria-busy={busy}>{busy ? "Открываем карту…" : "Найти ПВЗ на карте"}</button>}
    </div>
    <p className={renderAction ? "sr-only" : "ozon-search-help muted"} id={`${id}-help`}>Введите не менее двух букв и выберите город из подсказок.</p>
    <p className="sr-only" id={`${id}-status`} role="status">{suggesting ? "Ищем города…" : open && cities.length ? `Вариантов города: ${cities.length}. Используйте стрелки и Enter для выбора.` : ""}</p>
    {suggestionsUnavailable && <p className="muted" role="status">Подсказки временно недоступны. Проверьте название города и выполните поиск вручную.</p>}
    {message && <p className="notice" role="alert">{message}</p>}
    {renderAction?.(<button type="button" className="button button--small" aria-haspopup="dialog" disabled={busy || query.trim().length < 2} aria-busy={busy} onClick={() => onOpen ? onOpen() : void search()}>{busy ? "Открываем…" : actionLabel}</button>)}
  </div>;
}
