import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { deliveryConfigFingerprint, getOzonDeliveryConfig } from "@/lib/delivery/ozon-config";
import { OzonDeliveryClient } from "@/lib/delivery/ozon-client";
import { hasPointCoordinates } from "@/lib/delivery/points";
import type { PickupPoint } from "@/lib/delivery/points";
import { pointSearchTerms } from "@/lib/delivery/point-search";
import { pointSearchSql } from "@/lib/delivery/point-search-sql";
import { destinationCity } from "@/lib/delivery/destination-city";

export async function GET(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  if (!rateLimit(`ozon-points:${ip}`, 60, 60000).allowed) return Response.json({ error: "Слишком много запросов." }, { status: 429 });
  const url = new URL(request.url); const search = (url.searchParams.get("q") || "").trim();
  const cities = url.searchParams.get("view") === "cities";
  const empty = cities ? { cities: [] } : { points: [] };
  if (search.length < 2 || search.length > 120) return Response.json(empty);
  const terms = pointSearchTerms(search);
  if (!terms.length) return Response.json(empty);
  const suggest = url.searchParams.get("view") === "suggest";
  const rawOffset = url.searchParams.get("offset") ?? "0";
  if (!/^\d{1,7}$/.test(rawOffset) || Number(rawOffset) > 1000000) {
    return Response.json({ error: "Некорректная страница поиска." }, { status: 400 });
  }
  const offset = cities || suggest ? 0 : Number(rawOffset);
  const limit = cities ? 500 : suggest ? 8 : 200;
  const config = await getOzonDeliveryConfig();
  if (!config.enabled || !config.shipmentMethodId || !config.checkedAt) {
    return offset ? Response.json({ error: "Настройки доставки изменились. Повторите поиск." }, { status: 409 }) : Response.json(empty);
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
