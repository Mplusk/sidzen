"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MAX_VIEWPORT_LIST_POINTS, type MapBounds, type PickupViewport, type PickupViewportResult } from "@/lib/delivery/point-viewport";
import { hasPointCoordinates, type PickupPoint } from "@/lib/delivery/points";

const EMPTY: PickupViewportResult = { points: [], clusters: [], scope: "" };
const CACHE_TTL = 60_000;
const MAX_CACHED_AREAS = 12;
type CachedArea = { viewport: PickupViewport; result: PickupViewportResult; expires: number };
const contains = (outer: MapBounds, inner: MapBounds) => outer.west <= inner.west && outer.south <= inner.south && outer.east >= inner.east && outer.north >= inner.north;
const intersects = (a: MapBounds, b: MapBounds) => a.west <= b.east && a.east >= b.west && a.south <= b.north && a.north >= b.south;

function validListPoints(value: unknown): value is PickupPoint[] | undefined {
  return value === undefined || (Array.isArray(value) && value.length <= MAX_VIEWPORT_LIST_POINTS && value.every(point =>
    point && typeof point.id === "string" && point.id.length > 0 && typeof point.name === "string"
    && typeof point.address === "string" && typeof point.type === "string" && hasPointCoordinates(point)));
}

function padded(bounds: MapBounds): MapBounds {
  const lat = (bounds.north - bounds.south) * .12, lon = (bounds.east - bounds.west) * .12;
  return {
    south: Math.max(-85, Math.floor((bounds.south - lat) * 10000) / 10000),
    north: Math.min(85, Math.ceil((bounds.north + lat) * 10000) / 10000),
    west: Math.max(-180, Math.floor((bounds.west - lon) * 10000) / 10000),
    east: Math.min(180, Math.ceil((bounds.east + lon) * 10000) / 10000),
  };
}

/** Load only the current camera area; never prefetch the rest of a city. */
export function usePickupViewport(enabled: boolean) {
  const [result, setResult] = useState<PickupViewportResult>(EMPTY);
  const [viewport, setViewport] = useState<PickupViewport | null>(null);
  const [pending, setPending] = useState(enabled);
  const [error, setError] = useState("");
  const latest = useRef<PickupViewport | null>(null);
  const loadedArea = useRef<PickupViewport | null>(null);
  const cache = useRef<CachedArea[]>([]);
  const scope = useRef("");
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = useCallback(() => {
    generation.current++;
    controller.current?.abort(); controller.current = null;
    if (timer.current !== null) clearTimeout(timer.current);
    if (deadline.current !== null) clearTimeout(deadline.current);
    timer.current = null; deadline.current = null;
  }, []);
  useEffect(() => () => cancel(), [cancel]);

  const load = useCallback((next: PickupViewport, force = false) => {
    if (!enabled) return;
    // Leaflet may emit both zoomend and moveend for the same camera change.
    if (!force && latest.current && JSON.stringify(latest.current) === JSON.stringify(next)) return;
    cancel(); latest.current = next; setViewport(next); setError("");
    cache.current = cache.current.filter(entry => entry.expires > Date.now());
    const cached = !force && cache.current.find(entry => entry.viewport.zoom === next.zoom && contains(entry.viewport.bounds, next.bounds));
    if (cached) { loadedArea.current = cached.viewport; setResult(cached.result); setPending(false); return; }
    loadedArea.current = null; setResult(EMPTY);
    setPending(true);
    const version = generation.current;
    timer.current = setTimeout(async () => {
      timer.current = null;
      const request = new AbortController(); controller.current = request;
      deadline.current = setTimeout(() => request.abort(), 12000);
      const bounds = padded(next.bounds);
      try {
        const bbox = [bounds.west, bounds.south, bounds.east, bounds.north].join(",");
        const response = await fetch(`/api/delivery/ozon/points/?view=viewport&bbox=${encodeURIComponent(bbox)}&zoom=${next.zoom}`, { cache: "no-cache", signal: request.signal });
        if (!response.ok) throw new Error(response.status === 429 ? "rate-limit" : "points");
        const data = await response.json() as PickupViewportResult;
        if (!Array.isArray(data.points) || !Array.isArray(data.clusters) || typeof data.scope !== "string"
          || !validListPoints(data.listPoints)) throw new Error("points");
        if (generation.current !== version) return;
        if (request.signal.aborted) throw new Error("timeout");
        if (scope.current !== data.scope) { cache.current = []; scope.current = data.scope; }
        loadedArea.current = { bounds, zoom: next.zoom };
        cache.current.push({ viewport: loadedArea.current, result: data, expires: Date.now() + CACHE_TTL });
        if (cache.current.length > MAX_CACHED_AREAS) cache.current.shift();
        setResult(data);
      } catch (failure) {
        if (generation.current === version) setError(failure instanceof Error && failure.message === "rate-limit" ? "Слишком много перемещений карты. Подождите немного и повторите загрузку." : "Не удалось загрузить пункты в этой области. Повторите загрузку.");
      } finally {
        if (generation.current === version) {
          if (deadline.current !== null) clearTimeout(deadline.current);
          deadline.current = null; controller.current = null; setPending(false);
        }
      }
    }, 220);
  }, [cancel, enabled]);
  const onViewportChange = useCallback((next: PickupViewport) => load(next), [load]);
  const retry = useCallback(() => { if (latest.current) load(latest.current, true); }, [load]);
  const loadMore = useCallback(async () => {
    const area = loadedArea.current;
    const offset = result.nextOffset;
    if (!enabled || pending || controller.current || !area || offset == null) return;
    cancel(); setPending(true); setError("");
    const version = generation.current;
    const request = new AbortController(); controller.current = request;
    deadline.current = setTimeout(() => request.abort(), 12000);
    try {
      const b = area.bounds;
      const bbox = [b.west, b.south, b.east, b.north].join(",");
      const response = await fetch(`/api/delivery/ozon/points/?view=viewport&bbox=${encodeURIComponent(bbox)}&zoom=${area.zoom}&offset=${offset}`, { cache: "no-cache", signal: request.signal });
      if (!response.ok) throw new Error("points");
      const data = await response.json() as PickupViewportResult;
      if (generation.current !== version) return;
      if (request.signal.aborted || !Array.isArray(data.points) || !Array.isArray(data.clusters) || !validListPoints(data.listPoints) || data.scope !== result.scope || (data.nextOffset != null && (!Number.isSafeInteger(data.nextOffset) || data.nextOffset <= offset))) throw new Error("points");
      const joined = { ...data, points: [...new Map([...result.points, ...data.points].map(point => [point.id, point])).values()] };
      const entry = cache.current.find(entry => entry.viewport === area);
      if (entry) entry.result = joined;
      setResult(joined);
    } catch {
      if (generation.current === version) setError("Не удалось загрузить следующие пункты. Повторите загрузку области.");
    } finally {
      if (generation.current === version) {
        if (deadline.current !== null) clearTimeout(deadline.current);
        deadline.current = null; controller.current = null; setPending(false);
      }
    }
  }, [cancel, enabled, pending, result]);
  // Markers from the previous district must not appear as results for the new
  // district while its request is pending. The selected point lives separately.
  const visible = useMemo(() => {
    if (!viewport) return { ...EMPTY, listPoints: [] };
    const b = viewport.bounds;
    const inViewport = (p: PickupPoint) => p.latitude !== null && p.longitude !== null && p.latitude >= b.south && p.latitude <= b.north && p.longitude >= b.west && p.longitude <= b.east;
    return {
      points: result.points.filter(inViewport),
      // Sidebar previews must not become markers on top of the same clusters.
      listPoints: [...new Map((result.listPoints ?? result.points).filter(inViewport).map(point => [point.id, point])).values()],
      clusters: result.clusters.filter(cluster => intersects(cluster.bounds, b)).map(cluster => ({
        ...cluster,
        // A padded request may group border points around a center outside
        // the screen. Keep the marker visible; its drill-down bounds stay exact.
        latitude: Math.max(b.south + (b.north - b.south) * .01, Math.min(b.north - (b.north - b.south) * .01, cluster.latitude)),
        longitude: Math.max(b.west + (b.east - b.west) * .01, Math.min(b.east - (b.east - b.west) * .01, cluster.longitude)),
      })),
      scope: result.scope,
      nextOffset: result.nextOffset,
    };
  }, [result, viewport]);
  return { ...visible, pending, error, onViewportChange, retry, loadMore };
}
