import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { deliveryConfigFingerprint, getOzonDeliveryConfig } from "@/lib/delivery/ozon-config";
import { OzonDeliveryClient } from "@/lib/delivery/ozon-client";
import { hasPointCoordinates } from "@/lib/delivery/points";
import type { PickupPoint } from "@/lib/delivery/points";
import { pointSearchTerms } from "@/lib/delivery/point-search";
import { pointSearchSql } from "@/lib/delivery/point-search-sql";
import { destinationCity } from "@/lib/delivery/destination-city";
import { pointMapCache } from "@/lib/delivery/point-map-cache";
import { cityIndex, rankCities } from "@/lib/delivery/city-suggestions";
import { MAX_VIEWPORT_POINTS, normalizePickupCity, parsePickupViewport, parseViewportOffset, pickupCityOverview, pickupCityPattern, pickupViewportResult, type PickupViewportRow } from "@/lib/delivery/point-viewport";
import { pickupCitySql, pickupViewportSql } from "@/lib/delivery/point-viewport-sql";

async function progressiveMap(request: Request, url: URL, search: string) {
  const city = url.searchParams.get("view") === "city";
  const viewport = city ? null : parsePickupViewport(url.searchParams.get("bbox"), url.searchParams.get("zoom"));
  const offset = city ? 0 : parseViewportOffset(url.searchParams.get("offset"), viewport?.zoom ?? 0);
  if (city ? search.length > 120 || !pickupCityPattern(search) || !pointSearchTerms(normalizePickupCity(search)).length : !viewport || offset === null) {
    return Response.json({ error: "Некорректная область карты или название города." }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }
  try {
    const config = await getOzonDeliveryConfig();
    if (!config.enabled || !config.shipmentMethodId || !config.checkedAt) {
      return Response.json({ error: "Доставка временно недоступна." }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
    }
    const sync = await prisma.ozonDeliverySync.findUnique({ where: { id: "ozon" }, select: { generation: true, status: true } });
    const scope = createHash("sha256").update(JSON.stringify([deliveryConfigFingerprint(config), sync?.generation ?? null, sync?.status ?? null])).digest("hex");
    const key = JSON.stringify([scope, city ? "city" : "viewport", city ? normalizePickupCity(search) : viewport, offset]);
    const methodId = BigInt(config.shipmentMethodId);
    const payload = await pointMapCache.get(key, async () => {
      if (city) {
        const rows = await prisma.$queryRaw<Array<{ latitude: number | null; longitude: number | null }>>(pickupCitySql(config.clientId, methodId, search));
        return JSON.stringify({ city: pickupCityOverview(search, rows), scope });
      }
      const rows = await prisma.$queryRaw<PickupViewportRow[]>(pickupViewportSql(config.clientId, methodId, viewport!, offset!));
      const paginated = viewport!.zoom === 18;
      const result = pickupViewportResult(paginated ? rows.slice(0, MAX_VIEWPORT_POINTS) : rows, scope);
      return JSON.stringify({ ...result, ...(paginated ? { nextOffset: rows.length > MAX_VIEWPORT_POINTS ? offset! + MAX_VIEWPORT_POINTS : null } : {}) });
    });
    const headers = { "Cache-Control": "private, no-cache", "ETag": payload.etag, "Content-Type": "application/json; charset=utf-8" };
    const matches = request.headers.get("if-none-match")?.split(",").some(value => value.trim() === "*" || value.trim().replace(/^W\//, "") === payload.etag);
    return new Response(matches ? null : payload.body, { status: matches ? 304 : 200, headers });
  } catch {
    return Response.json({ error: "Не удалось загрузить карту. Повторите попытку." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}

export async function GET(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  if (!rateLimit(`ozon-points:${ip}`, 60, 60000).allowed) return Response.json({ error: "Слишком много запросов." }, { status: 429, headers: { "Cache-Control": "private, no-store" } });
  const url = new URL(request.url); const search = (url.searchParams.get("q") || "").trim();
  if (url.searchParams.get("view") === "city" || url.searchParams.get("view") === "viewport") return progressiveMap(request, url, search);
  const cities = url.searchParams.get("view") === "cities";
  const empty = cities ? { cities: [] } : { points: [] };
  if (search.length < 2 || search.length > 120) return Response.json(empty, { headers: { "Cache-Control": "private, no-store" } });
  const terms = pointSearchTerms(search);
  if (!terms.length) return Response.json(empty, { headers: { "Cache-Control": "private, no-store" } });
  const suggest = url.searchParams.get("view") === "suggest";
  const map = url.searchParams.get("view") === "map";
  const rawOffset = url.searchParams.get("offset") ?? "0";
  if (!/^\d{1,7}$/.test(rawOffset) || Number(rawOffset) > 1000000) {
    return Response.json({ error: "Некорректная страница поиска." }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }
  const offset = cities || suggest ? 0 : Number(rawOffset);
  const limit = cities ? 500 : suggest ? 8 : map ? 5000 : 200;
  const config = await getOzonDeliveryConfig();
  if (!config.enabled || !config.shipmentMethodId || !config.checkedAt) {
    return offset ? Response.json({ error: "Настройки доставки изменились. Повторите поиск." }, { status: 409, headers: { "Cache-Control": "private, no-store" } }) : Response.json(empty, { headers: { "Cache-Control": "private, no-store" } });
  }
  if (map) {
    try {
      // Check the current integration and sync identity on every request, even
      // a conditional browser request. A new/finished refresh gets a new key.
      const sync = await prisma.ozonDeliverySync.findUnique({ where: { id: "ozon" }, select: { generation: true, status: true } });
      const scope = createHash("sha256").update(JSON.stringify([deliveryConfigFingerprint(config), sync?.generation ?? null, sync?.status ?? null])).digest("hex");
      const key = JSON.stringify([scope, terms, offset, limit]);
      const methodId = BigInt(config.shipmentMethodId);
      const payload = await pointMapCache.get(key, async () => {
        // Map opening never waits for Ozon or writes coordinates. The worker
        // updates public points in the background; checkout verifies availability.
        const rows = await prisma.$queryRaw<PickupPoint[]>(pointSearchSql(config.clientId, methodId, terms, limit + 1, offset));
        const truncated = rows.length > limit;
        return JSON.stringify({ points: rows.slice(0, limit), truncated, nextOffset: truncated ? offset + limit : null, scope });
      });
      const headers = { "Cache-Control": "private, no-cache", "ETag": payload.etag, "Content-Type": "application/json; charset=utf-8" };
      const matches = request.headers.get("if-none-match")?.split(",").some(value => value.trim() === "*" || value.trim().replace(/^W\//, "") === payload.etag);
      return new Response(matches ? null : payload.body, { status: matches ? 304 : 200, headers });
    } catch {
      return Response.json({ error: "Не удалось загрузить пункты. Повторите поиск." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
    }
  }
  // All values are bound parameters. Do not interpolate user input as SQL.
  const rows = await prisma.$queryRaw<PickupPoint[]>(pointSearchSql(config.clientId, BigInt(config.shipmentMethodId), terms, limit + 1, offset));
  if (cities) {
    const normalize = (value: string) => value.toLocaleLowerCase("ru").replaceAll("ё", "е").replace(/\s+/g, " ").trim();
    const prefix = normalize(search);
    const seen = new Set<string>();
    const names: string[] = [];
    for (const row of rows.slice(0, limit)) {
      const city = destinationCity(row.address, "ozon-delivery");
      if (!city) continue;
      const key = normalize(city);
      if (key.startsWith(prefix) && !seen.has(key)) { seen.add(key); names.push(city); }
      if (names.length === 8) break;
    }
    // A typo cannot match the indexed prefix search above. Build a shared
    // directory index only for meaningful input, not for every keystroke.
    if (prefix.length >= 4 && prefix.length <= 80) {
      try {
        const sync = await prisma.ozonDeliverySync.findUnique({ where: { id: "ozon" }, select: { generation: true, status: true } });
        const key = JSON.stringify([deliveryConfigFingerprint(config), sync?.generation ?? null, sync?.status ?? null]);
        const methodId = BigInt(config.shipmentMethodId);
        const dictionary = await cityIndex(key, () => prisma.$queryRaw<{ address: string }[]>`
          SELECT DISTINCT "address" FROM "OzonDeliveryPoint"
          WHERE "clientId" = ${config.clientId} AND "methodId" = ${methodId} AND "active" = true
        `);
        return Response.json({ cities: rankCities(search, dictionary, names) }, { headers: { "Cache-Control": "private, no-store" } });
      } catch {
        // Keep exact prefix results usable, but tell the client that typo
        // suggestions could not be loaded.
        return Response.json({ cities: names, suggestionsUnavailable: true }, { headers: { "Cache-Control": "private, no-store" } });
      }
    }
    return Response.json({ cities: names }, { headers: { "Cache-Control": "private, no-store" } });
  }
  const points = rows.slice(0, limit);
  const inactive = new Set<string>();
  // Existing directories predate coordinate storage. Fill only the searched
  // public points, without sending recipient data or restarting the full sync.
  const missing = points.filter(point => !hasPointCoordinates(point));
  if (!suggest && missing.length && config.clientSecret) {
    try {
      const api = new OzonDeliveryClient(config);
      for (let offset = 0; offset < missing.length; offset += 100) {
        const batch = missing.slice(offset, offset + 100);
        for (const detail of await api.pointInfo(batch.map(point => Number(point.id)))) {
          const point = batch.find(point => point.id === String(detail.delivery_point_id));
          if (!point) continue;
          if (!detail.is_active) { inactive.add(point.id); continue; }
          if (!detail.coordinates) continue;
          point.latitude = detail.coordinates.latitude; point.longitude = detail.coordinates.longitude;
          await prisma.ozonDeliveryPoint.updateMany({ where: { id: point.id, clientId: config.clientId, methodId: BigInt(config.shipmentMethodId), active: true }, data: { latitude: point.latitude, longitude: point.longitude } });
        }
      }
    } catch { /* Directory selection still works if the map refresh is unavailable. */ }
  }
  const truncated = rows.length > limit;
  // Advance over the raw page, including any inactive points removed above.
  // Stable address/id ordering lets the map load the complete city directory.
  return Response.json({ points: points.filter(point => !inactive.has(point.id)), truncated, nextOffset: !suggest && truncated ? offset + limit : null, scope: deliveryConfigFingerprint(config) }, { headers: { "Cache-Control": "private, no-store" } });
}
