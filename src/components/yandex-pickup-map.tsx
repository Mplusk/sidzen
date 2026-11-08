"use client";

import { useEffect, useRef, useState } from "react";
import { hasPointCoordinates, initialMapPoints, type PickupPoint } from "@/lib/delivery/points";

type Point = [number, number];
type YandexMark = {
  events: { add: (name: string, handler: () => void) => void };
  options: { set: (name: string, value: string) => void };
};
type YandexMap = {
  geoObjects: { add: (object: unknown) => void };
  behaviors: { disable: (name: string) => void };
  setBounds: (bounds: [Point, Point], options: Record<string, unknown>) => unknown;
  setCenter: (point: Point, zoom?: number, options?: Record<string, unknown>) => unknown;
  destroy: () => void;
};
type YandexApi = {
  ready: (success: () => void, failure: () => void) => void;
  Map: new (container: HTMLElement, state: Record<string, unknown>) => YandexMap;
  Placemark: new (point: Point, properties: Record<string, unknown>, options: Record<string, unknown>) => YandexMark;
  Clusterer: new (options: Record<string, unknown>) => { add: (marks: YandexMark[]) => void };
};
declare global { interface Window { ymaps?: YandexApi } }

let loading: Promise<YandexApi> | null = null;
function loadYandex(apiKey: string): Promise<YandexApi> {
  if (loading) return loading;
  if (window.ymaps) return Promise.resolve(window.ymaps);
  loading = new Promise<YandexApi>((resolve, reject) => {
    const script = document.createElement("script");
    const timeout = setTimeout(() => fail(), 15000);
    function fail() { clearTimeout(timeout); script.remove(); reject(new Error("yandex-map-unavailable")); }
    script.async = true;
    script.referrerPolicy = "origin";
    script.src = `https://api-maps.yandex.ru/2.1/?lang=ru_RU&apikey=${encodeURIComponent(apiKey)}`;
    script.onerror = fail;
    script.onload = () => {
      if (!window.ymaps) return fail();
      window.ymaps.ready(() => { clearTimeout(timeout); resolve(window.ymaps!); }, fail);
    };
    document.head.append(script);
  }).catch(error => { loading = null; throw error; });
  return loading;
}

export default function YandexPickupMap({ apiKey, points, selected, onSelect, carrier, onError }: {
  apiKey: string; points: PickupPoint[]; selected: string; onSelect: (id: string) => void; carrier: "Ozon" | "СДЭК"; onError: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<YandexMap | null>(null);
  const marks = useRef(new Map<string, YandexMark>());
  const select = useRef(onSelect);
  const selectedRef = useRef(selected);
  const errorRef = useRef(onError);
  const [ready, setReady] = useState(false);
  useEffect(() => { select.current = onSelect; errorRef.current = onError; }, [onSelect, onError]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  useEffect(() => {
    let cancelled = false;
    const markerIndex = marks.current;
    void loadYandex(apiKey).then(api => {
      if (cancelled || !container.current) return;
      const focus = initialMapPoints(points);
      if (!focus.length) return;
      const instance = new api.Map(container.current, { center: [focus[0].latitude, focus[0].longitude], zoom: 12, controls: ["zoomControl", "fullscreenControl"] });
      map.current = instance;
      instance.behaviors.disable("scrollZoom");
      const cluster = new api.Clusterer({ preset: carrier === "Ozon" ? "islands#blueClusterIcons" : "islands#greenClusterIcons", groupByCoordinates: false });
      const markerList = points.filter(hasPointCoordinates).map(point => {
        const marker = new api.Placemark([point.latitude, point.longitude], {}, { preset: "islands#circleDotIcon", iconColor: point.id === selectedRef.current ? "#6b6f5b" : carrier === "Ozon" ? "#005bff" : "#008b46" });
        marker.events.add("click", () => select.current(point.id));
        markerIndex.set(point.id, marker);
        return marker;
      });
      cluster.add(markerList); instance.geoObjects.add(cluster);
      if (focus.length > 1) {
        const lats = focus.map(point => point.latitude), lons = focus.map(point => point.longitude);
        void instance.setBounds([[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]], { checkZoomRange: true, zoomMargin: 35 });
      }
      setReady(true);
    }).catch(() => { if (!cancelled) errorRef.current(); });
    return () => { cancelled = true; map.current?.destroy(); map.current = null; markerIndex.clear(); };
  }, [apiKey, points, carrier]);
  useEffect(() => {
    if (!ready) return;
    for (const [id, mark] of marks.current) mark.options.set("iconColor", id === selected ? "#6b6f5b" : carrier === "Ozon" ? "#005bff" : "#008b46");
    const point = points.find(value => value.id === selected);
    if (point && hasPointCoordinates(point)) void map.current?.setCenter([point.latitude, point.longitude], 15, { duration: 250 });
  }, [ready, selected, points, carrier]);
  return <div className="ozon-map-wrapper"><div ref={container} className="ozon-pickup-map" role="region" aria-label={`Яндекс Карта пунктов выдачи ${carrier}`} />{!ready && <p className="muted" role="status">Загружаем Яндекс Карты…</p>}</div>;
}
