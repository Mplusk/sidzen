import { initialMapPoints, type PickupPoint } from "./points";

export type MapBounds = { south: number; west: number; north: number; east: number };
export type PickupCluster = { id: string; latitude: number; longitude: number; count: number; bounds: MapBounds };
export type PickupMapCity = { name: string; bounds: MapBounds };
export type PickupViewport = { bounds: MapBounds; zoom: number };
export type PickupViewportResult = { points: PickupPoint[]; clusters: PickupCluster[]; scope: string; nextOffset?: number | null; listPoints?: PickupPoint[] };

export const MAX_VIEWPORT_POINTS = 500;
export const MAX_VIEWPORT_LIST_POINTS = 20;

// Keep the city overview sparse; reveal more detail as the buyer zooms in.
// The same budget applies to individual points, otherwise a city with fewer
// than 500 points would bypass aggregation and still fill the entire map.
// Maximum zoom uses explicit point pagination instead of this density.
export function pickupViewportDensity(zoom: number) {
  const gridSize = zoom <= 11 ? 5 : zoom <= 13 ? 6 : zoom <= 15 ? 7 : 8;
  return { gridSize, pointBudget: gridSize * gridSize };
}

export function parsePickupViewport(bbox: string | null, zoomValue: string | null): PickupViewport | null {
  if (!bbox || bbox.length > 120 || !zoomValue || !/^\d{1,2}$/.test(zoomValue)) return null;
  const tokens = bbox.split(",");
  if (tokens.length !== 4 || tokens.some(value => !/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value))) return null;
  const [west, south, east, north] = tokens.map(Number);
  const zoom = Number(zoomValue);
  if (![west, south, east, north].every(Number.isFinite) || west < -180 || east > 180 || south < -85.051129 || north > 85.051129 || west >= east || south >= north || zoom < 3 || zoom > 18) return null;
  return { bounds: { south, west, north, east }, zoom };
}

export function parseViewportOffset(value: string | null, zoom: number): number | null {
  const offset = value ?? "0";
  if (!/^\d{1,7}$/.test(offset) || Number(offset) > 1000000 || (zoom !== 18 && Number(offset) !== 0)) return null;
  return Number(offset);
}

export function normalizePickupCity(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ru").replaceAll("ё", "е").replace(/\s+/g, " ").trim()
    .replace(/^(?:город\s+|г\.\s*|г\s+)/u, "").replace(/\s+(?:город|г\.?)$/u, "").trim();
}

// City searches use a whole comma-delimited address component. Prefix matches
// remain useful for suggestions, but must never open a similarly named street.
export function pickupCityPattern(search: string) {
  const name = normalizePickupCity(search);
  if (name.length < 2 || name.length > 100 || !/^[\p{L}][\p{L}\p{N}\s.'’\-]*$/u.test(name)) return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replaceAll(" ", "[[:space:]]+");
  const locality = "(?:город|г[.]?|пос[её]лок|пос[.]?|пгт[.]?|село|с[.]?|деревня|д[.]?|станица|ст-ца)";
  const prefix = "(?:(?:г|пос|пгт|с|д)[.][[:space:]]*|(?:город|г|пос[её]лок|пос|пгт|село|с|деревня|д|станица|ст-ца)[[:space:]]+)";
  return `(^|,)[[:space:]]*(?:${prefix})?${escaped}(?:[[:space:]]+${locality})?[[:space:]]*(,|$)`;
}

export function pickupCityOverview(name: string, rows: Array<{ latitude: number | null; longitude: number | null }>): PickupMapCity | null {
  const focus = initialMapPoints(rows.map((row, index) => ({ ...row, id: String(index), name: "", address: "", type: "" })));
  if (!focus.length) return null;
  const { south, west, north, east } = focus.reduce((bounds, point) => ({
    south: Math.min(bounds.south, point.latitude), west: Math.min(bounds.west, point.longitude),
    north: Math.max(bounds.north, point.latitude), east: Math.max(bounds.east, point.longitude),
  }), { south: Infinity, west: Infinity, north: -Infinity, east: -Infinity });
  // A village with one point still gets a usable opening area, not a building.
  const latPadding = Math.max((north - south) * 0.05, 0.008);
  const lonPadding = Math.max((east - west) * 0.05, 0.012);
  return { name: name.trim(), bounds: { south: Math.max(-85.051128, south - latPadding), west: Math.max(-180, west - lonPadding), north: Math.min(85.051128, north + latPadding), east: Math.min(180, east + lonPadding) } };
}

export type PickupViewportRow = {
  id: string; count: number; latitude: number; longitude: number;
  south: number; west: number; north: number; east: number;
  name: string | null; address: string | null; type: string | null;
};

export function pickupViewportResult(rows: PickupViewportRow[], scope: string): PickupViewportResult {
  const points: PickupPoint[] = [], clusters: PickupCluster[] = [];
  for (const row of rows) {
    if (row.count === 1) points.push({ id: row.id, name: row.name ?? "Пункт Ozon", address: row.address ?? "", type: row.type ?? "", latitude: row.latitude, longitude: row.longitude });
    else clusters.push({ id: `cluster:${row.id}`, count: row.count, latitude: row.latitude, longitude: row.longitude, bounds: { south: row.south, west: row.west, north: row.north, east: row.east } });
  }
  return { points, clusters, scope };
}
