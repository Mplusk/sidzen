"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { hasPointCoordinates, type PickupPoint } from "@/lib/delivery/points";

export default function OzonPickupMap({ points, selected, onSelect }: { points: PickupPoint[]; selected: string; onSelect: (id: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef(new Map<string, L.Marker>());
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
      const button = document.createElement("button"); button.type = "button"; button.className = "button button--small"; button.textContent = "Выбрать этот ПВЗ"; button.onclick = () => selectRef.current(point.id);
      content.append(title, address, button);
      const marker = L.marker([point.latitude, point.longitude], { title: `ПВЗ: ${point.address}`, alt: `ПВЗ: ${point.address}`, icon: L.divIcon({ className: "ozon-map-pin", html: '<span aria-hidden="true">●</span>', iconSize: [28, 36], iconAnchor: [14, 36] }) }).bindPopup(content).addTo(map);
      markersRef.current.set(point.id, marker);
      return marker;
    });
    map.fitBounds(L.latLngBounds(located.map(point => [point.latitude, point.longitude])), { padding: [28, 28], maxZoom: 15 });
    const markerIndex = markersRef.current;
    return () => { for (const marker of markers) marker.remove(); markerIndex.clear(); };
  }, [points]);
  useEffect(() => {
    const point = points.find(point => point.id === selected);
    for (const [id, marker] of markersRef.current) marker.getElement()?.classList.toggle("ozon-map-pin--selected", id === selected);
    if (point && hasPointCoordinates(point)) mapRef.current?.panTo([point.latitude, point.longitude]);
  }, [points, selected]);
  return <div className="ozon-map-wrapper"><div ref={container} className="ozon-pickup-map" role="region" aria-label="Карта пунктов выдачи Ozon" />{tileError && <p className="muted" role="status">Подложка карты временно недоступна. ПВЗ можно выбрать по метке или из списка ниже.</p>}</div>;
}
