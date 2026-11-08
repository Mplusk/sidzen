"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet.markercluster";
import "leaflet.markercluster/dist/MarkerCluster.css";
import { hasPointCoordinates, initialMapPoints, type PickupPoint } from "@/lib/delivery/points";

function showSelection(button: HTMLButtonElement, selected: boolean) {
  button.classList.toggle("ozon-point-button--selected", selected);
  button.textContent = selected ? "✓ ПВЗ выбран" : "Выбрать этот ПВЗ";
  button.setAttribute("aria-pressed", String(selected));
}

export default function OzonPickupMap({ points, selected, onSelect, carrier = "Ozon", openPopupOnSelect = true }: { points: PickupPoint[]; selected: string; onSelect: (id: string) => void; carrier?: string; openPopupOnSelect?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clustersRef = useRef<L.MarkerClusterGroup | null>(null);
  const markersRef = useRef(new Map<string, L.Marker>());
  const buttonsRef = useRef(new Map<string, HTMLButtonElement>());
  const selectRef = useRef(onSelect);
  const selectedRef = useRef(selected);
  const [tileError, setTileError] = useState(false);
  const located = useMemo(() => points.filter(hasPointCoordinates), [points]);
  const focus = useMemo(() => initialMapPoints(points), [points]);
  useEffect(() => { selectRef.current = onSelect; }, [onSelect]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  const revealSelection = useCallback(() => {
    const id = selectedRef.current;
    const marker = markersRef.current.get(id);
    const clusters = clustersRef.current;
    // A selection can arrive while later marker batches are still loading.
    if (!marker || !clusters?.hasLayer(marker)) return;
    clusters.zoomToShowLayer(marker, () => {
      if (clustersRef.current !== clusters || selectedRef.current !== id) return;
      marker.getElement()?.classList.add("ozon-map-pin--selected");
      if (openPopupOnSelect) marker.openPopup();
    });
  }, [openPopupOnSelect]);
  useEffect(() => {
    if (!container.current) return;
    const map = L.map(container.current, { minZoom: 3, maxZoom: 18, scrollWheelZoom: true, touchZoom: true });
    mapRef.current = map;
    const tiles = L.tileLayer("/api/maps/tiles/{z}/{x}/{y}/", { maxZoom: 18, keepBuffer: 0, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>' }).addTo(map);
    tiles.on("tileerror", () => setTileError(true));
    tiles.on("tileload", () => setTileError(false));
    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(container.current);
    return () => { resize.disconnect(); map.remove(); mapRef.current = null; };
  }, []);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !located.length) return;
    const clusters = L.markerClusterGroup({
      maxClusterRadius: 52,
      showCoverageOnHover: false,
      animate: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      iconCreateFunction: cluster => {
        const count = cluster.getChildCount();
        return L.divIcon({ className: `pickup-cluster ${carrier === "Ozon" ? "pickup-cluster--ozon" : "pickup-cluster--cdek"}`, html: `<span aria-label="Пунктов выдачи: ${count}. Увеличить карту">${count}</span>`, iconSize: [40, 40] });
      },
    }).addTo(map);
    clustersRef.current = clusters;
    const markers = located.map(point => {
      const marker = L.marker([point.latitude, point.longitude], { title: `ПВЗ: ${point.address}`, alt: `ПВЗ: ${point.address}`, icon: L.divIcon({ className: `ozon-map-pin ${carrier === "Ozon" ? "ozon-map-pin--ozon" : "ozon-map-pin--cdek"}`, html: '<span aria-hidden="true">●</span>', iconSize: [28, 36], iconAnchor: [14, 36] }) });
      if (openPopupOnSelect) {
        const content = document.createElement("div");
        const title = document.createElement("strong"); title.textContent = point.name;
        const address = document.createElement("p"); address.textContent = point.address;
        const button = document.createElement("button"); button.type = "button"; button.className = "button button--small";
        showSelection(button, false);
        button.onclick = () => { showSelection(button, true); selectRef.current(point.id); };
        buttonsRef.current.set(point.id, button);
        content.append(title, address, button);
        marker.bindPopup(content);
      }
      else marker.on("click", () => selectRef.current(point.id));
      marker.on("add", () => marker.getElement()?.classList.toggle("ozon-map-pin--selected", selectedRef.current === point.id));
      markersRef.current.set(point.id, marker);
      return marker;
    });
    map.fitBounds(L.latLngBounds(focus.map(point => [point.latitude, point.longitude])), { padding: [28, 28], maxZoom: 15 });
    // Native chunkedLoading has no cancellation API. Small public addLayers
    // batches yield to the UI and can be cancelled when the city/dialog changes.
    let offset = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const addBatch = () => {
      const start = offset;
      const batch = markers.slice(start, start + 200);
      clusters.addLayers(batch);
      offset += batch.length;
      const selectedMarker = markersRef.current.get(selectedRef.current);
      if (start > 0 && selectedMarker && batch.includes(selectedMarker)) revealSelection();
      if (offset < markers.length) timer = setTimeout(addBatch, 0);
    };
    addBatch();
    const markerIndex = markersRef.current;
    const buttonIndex = buttonsRef.current;
    return () => { clearTimeout(timer); clusters.remove(); for (const marker of markers) marker.remove(); markerIndex.clear(); buttonIndex.clear(); clustersRef.current = null; };
  }, [located, focus, carrier, openPopupOnSelect, revealSelection]);
  useEffect(() => {
    for (const [id, marker] of markersRef.current) marker.getElement()?.classList.toggle("ozon-map-pin--selected", id === selected);
    for (const [id, button] of buttonsRef.current) showSelection(button, id === selected);
    revealSelection();
  }, [located, selected, carrier, revealSelection]);
  return <div className="ozon-map-wrapper"><div ref={container} className="ozon-pickup-map" role="region" aria-label={`Карта пунктов выдачи ${carrier}`} />{tileError && <p className="muted" role="status">Подложка карты временно недоступна. ПВЗ можно выбрать по метке или из списка ниже.</p>}</div>;
}
