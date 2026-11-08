"use client";

import { useEffect, useRef, useState } from "react";
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
  useEffect(() => { selectRef.current = onSelect; }, [onSelect]);
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
    const located = points.filter(hasPointCoordinates);
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
      const content = document.createElement("div");
      const title = document.createElement("strong"); title.textContent = point.name;
      const address = document.createElement("p"); address.textContent = point.address;
      const button = document.createElement("button"); button.type = "button"; button.className = "button button--small";
      showSelection(button, false);
      button.onclick = () => { showSelection(button, true); selectRef.current(point.id); };
      buttonsRef.current.set(point.id, button);
      content.append(title, address, button);
      const marker = L.marker([point.latitude, point.longitude], { title: `ПВЗ: ${point.address}`, alt: `ПВЗ: ${point.address}`, icon: L.divIcon({ className: `ozon-map-pin ${carrier === "Ozon" ? "ozon-map-pin--ozon" : "ozon-map-pin--cdek"}`, html: '<span aria-hidden="true">●</span>', iconSize: [28, 36], iconAnchor: [14, 36] }) }).bindPopup(content);
      clusters.addLayer(marker);
      markersRef.current.set(point.id, marker);
      return marker;
    });
    const focus = initialMapPoints(points);
    map.fitBounds(L.latLngBounds(focus.map(point => [point.latitude, point.longitude])), { padding: [28, 28], maxZoom: 15 });
    const markerIndex = markersRef.current;
    const buttonIndex = buttonsRef.current;
    return () => { clusters.remove(); for (const marker of markers) marker.remove(); markerIndex.clear(); buttonIndex.clear(); clustersRef.current = null; };
  }, [points, carrier]);
  useEffect(() => {
    selectedRef.current = selected;
    const point = points.find(point => point.id === selected);
    for (const [id, marker] of markersRef.current) marker.getElement()?.classList.toggle("ozon-map-pin--selected", id === selected);
    for (const [id, button] of buttonsRef.current) showSelection(button, id === selected);
    if (point && hasPointCoordinates(point)) {
      const marker = markersRef.current.get(point.id);
      if (marker && clustersRef.current) clustersRef.current.zoomToShowLayer(marker, () => {
        if (selectedRef.current !== point.id) return;
        marker.getElement()?.classList.add("ozon-map-pin--selected");
        if (openPopupOnSelect) marker.openPopup();
      });
    }
  }, [points, selected, openPopupOnSelect]);
  const focused = initialMapPoints(points).length;
  return <div className="ozon-map-wrapper"><div ref={container} className="ozon-pickup-map" role="region" aria-label={`Карта пунктов выдачи ${carrier}`} />{focused < points.filter(hasPointCoordinates).length && <p className="muted">Карта открыта в районе большинства найденных ПВЗ. Пункты в других районах тоже доступны: выберите адрес в списке — карта перейдёт к нему.</p>}{tileError && <p className="muted" role="status">Подложка карты временно недоступна. ПВЗ можно выбрать по метке или из списка ниже.</p>}</div>;
}
