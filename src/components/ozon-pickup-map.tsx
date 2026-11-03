"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { hasPointCoordinates, initialMapPoints, type PickupPoint } from "@/lib/delivery/points";

function showSelection(button: HTMLButtonElement, selected: boolean) {
  button.classList.toggle("ozon-point-button--selected", selected);
  button.textContent = selected ? "✓ ПВЗ выбран" : "Выбрать этот ПВЗ";
  button.setAttribute("aria-pressed", String(selected));
}

export default function OzonPickupMap({ points, selected, onSelect, carrier = "Ozon" }: { points: PickupPoint[]; selected: string; onSelect: (id: string) => void; carrier?: string }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef(new Map<string, L.Marker>());
  const buttonsRef = useRef(new Map<string, HTMLButtonElement>());
  const selectRef = useRef(onSelect);
  const [tileError, setTileError] = useState(false);
  useEffect(() => { selectRef.current = onSelect; }, [onSelect]);
  useEffect(() => {
    if (!container.current) return;
    const map = L.map(container.current, { minZoom: 3, maxZoom: 18, scrollWheelZoom: false });
    mapRef.current = map;
    const tiles = L.tileLayer("/api/maps/tiles/{z}/{x}/{y}/", { maxZoom: 18, keepBuffer: 0, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>' }).addTo(map);
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
    const markers = located.map(point => {
      const content = document.createElement("div");
      const title = document.createElement("strong"); title.textContent = point.name;
      const address = document.createElement("p"); address.textContent = point.address;
      const button = document.createElement("button"); button.type = "button"; button.className = "button button--small";
      showSelection(button, false);
      button.onclick = () => { showSelection(button, true); selectRef.current(point.id); };
      buttonsRef.current.set(point.id, button);
      content.append(title, address, button);
      const marker = L.marker([point.latitude, point.longitude], { title: `ПВЗ: ${point.address}`, alt: `ПВЗ: ${point.address}`, icon: L.divIcon({ className: "ozon-map-pin", html: '<span aria-hidden="true">●</span>', iconSize: [28, 36], iconAnchor: [14, 36] }) }).bindPopup(content).addTo(map);
      markersRef.current.set(point.id, marker);
      return marker;
    });
    const focus = initialMapPoints(points);
    map.fitBounds(L.latLngBounds(focus.map(point => [point.latitude, point.longitude])), { padding: [28, 28], maxZoom: 15 });
    const markerIndex = markersRef.current;
    const buttonIndex = buttonsRef.current;
    return () => { for (const marker of markers) marker.remove(); markerIndex.clear(); buttonIndex.clear(); };
  }, [points]);
  useEffect(() => {
    const point = points.find(point => point.id === selected);
    for (const [id, marker] of markersRef.current) marker.getElement()?.classList.toggle("ozon-map-pin--selected", id === selected);
    for (const [id, button] of buttonsRef.current) showSelection(button, id === selected);
    if (point && hasPointCoordinates(point)) {
      mapRef.current?.panTo([point.latitude, point.longitude]);
      markersRef.current.get(point.id)?.openPopup();
    }
  }, [points, selected]);
  const focused = initialMapPoints(points).length;
  return <div className="ozon-map-wrapper"><div ref={container} className="ozon-pickup-map" role="region" aria-label={`Карта пунктов выдачи ${carrier}`} />{focused < points.filter(hasPointCoordinates).length && <p className="muted">Карта открыта в районе большинства найденных ПВЗ. Пункты в других районах тоже доступны: выберите адрес в списке — карта перейдёт к нему.</p>}{tileError && <p className="muted" role="status">Подложка карты временно недоступна. ПВЗ можно выбрать по метке или из списка ниже.</p>}</div>;
}
