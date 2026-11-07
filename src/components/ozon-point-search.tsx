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
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);

  function cancel() {
    generation.current++;
    request.current?.abort();
    request.current = null;
  }
  useEffect(() => () => { generation.current++; request.current?.abort(); }, []);

  async function search() {
    if (query.trim().length < 2 || busy) return;
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

  return <div className="ozon-search">
    <div className="ozon-point-search">
      <div className="ozon-search-field">
        <label className="field" htmlFor={id}><span>Город</span></label>
        <input id={id} aria-describedby={`${id}-help`} autoComplete="address-level2" value={query} maxLength={120}
          onChange={event => { cancel(); setBusy(false); setQuery(event.target.value); setMessage(""); onReset(); }}
          onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); void search(); } }}
          placeholder="Например, Омск" />
      </div>
      <button type="button" className="button button--outline" onClick={() => void search()} disabled={busy || query.trim().length < 2} aria-busy={busy}>{busy ? "Ищем ПВЗ…" : "Найти ПВЗ на карте"}</button>
    </div>
    <p className="ozon-search-help muted" id={`${id}-help`}>Введите не менее двух букв.</p>
    {message && <p className="notice" role="alert">{message}</p>}
  </div>;
}
