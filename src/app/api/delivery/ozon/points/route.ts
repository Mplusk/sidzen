import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getOzonDeliveryConfig } from "@/lib/delivery/ozon-config";
import { OzonDeliveryClient } from "@/lib/delivery/ozon-client";
import { hasPointCoordinates } from "@/lib/delivery/points";
import type { PickupPoint } from "@/lib/delivery/points";
import { pointCoordinatesSchema } from "@/lib/delivery/ozon-client";
import { hasTrustedOrigin } from "@/lib/request-security";
import { operatorReady } from "@/lib/privacy";
import { approximatePosition } from "@/lib/delivery/picker-state";

// Coordinates stay out of URLs, access logs, persistent storage and Ozon calls.
export async function POST(request: Request) {
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
  if (!hasTrustedOrigin(request)) return reply({ error: "Недопустимый источник запроса." }, 403);
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  if (!rateLimit(`ozon-points:${ip}`, 60, 60000).allowed) return reply({ error: "Слишком много запросов. Повторите через минуту." }, 429);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return reply({ error: "Некорректный запрос." }, 400);
  const body = await request.text();
  if (body.length > 256) return reply({ error: "Некорректный запрос." }, 400);
  let input;
  try { input = pointCoordinatesSchema.strict().safeParse(JSON.parse(body)); } catch { return reply({ error: "Некорректная геопозиция." }, 400); }
  if (!input.success) return reply({ error: "Некорректная геопозиция." }, 400);
  if (!await operatorReady()) return reply({ error: "Поиск по геопозиции временно недоступен. Введите город вручную." }, 503);
  const config = await getOzonDeliveryConfig();
  if (!config.enabled || !config.shipmentMethodId || !config.checkedAt) return reply({ error: "Ozon Доставка временно недоступна." }, 503);
  const scope = { clientId: config.clientId, methodId: BigInt(config.shipmentMethodId), active: true };
  // Never advertise a cached distant PVZ as the nearest while the old directory
  // still lacks coordinates. Maintenance fills only public point information.
  if (await prisma.ozonDeliveryPoint.count({ where: { ...scope, OR: [{ latitude: null }, { longitude: null }] } })) return reply({ error: "Справочник координат ПВЗ обновляется. Пока найдите ПВЗ по городу или улице." }, 503);
  const { latitude, longitude } = approximatePosition(input.data.latitude, input.data.longitude);
  try {
    const points = await prisma.$queryRaw<PickupPoint[]>`
      SELECT id, name, address, type, latitude, longitude, "distanceKm" FROM (
        SELECT id, name, address, type, latitude, longitude,
          6371 * acos(least(1.0, greatest(-1.0,
            sin(radians(latitude)) * sin(radians(${latitude}::double precision)) +
            cos(radians(latitude)) * cos(radians(${latitude}::double precision)) * cos(radians(longitude - ${longitude}::double precision))
          ))) AS "distanceKm"
        FROM "OzonDeliveryPoint"
        WHERE "clientId" = ${config.clientId} AND "methodId" = ${scope.methodId} AND active
          AND latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180
          AND NOT (latitude = 0 AND longitude = 0)
      ) AS nearby WHERE "distanceKm" <= 50 ORDER BY "distanceKm", id LIMIT 61
    `;
    return reply({ points: points.slice(0, 60).map(point => ({ ...point, distanceKm: Math.round(point.distanceKm! * 10) / 10 })), truncated: points.length > 60, nearby: true });
  } catch { return reply({ error: "Не удалось загрузить ближайшие ПВЗ. Повторите попытку или введите город вручную." }, 503); }
}

export async function GET(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  if (!rateLimit(`ozon-points:${ip}`, 60, 60000).allowed) return Response.json({ error: "Слишком много запросов." }, { status: 429 });
  const url = new URL(request.url); const search = (url.searchParams.get("q") || "").trim();
  if (search.length < 2 || search.length > 120) return Response.json({ points: [] });
  const config = await getOzonDeliveryConfig();
  if (!config.enabled || !config.shipmentMethodId || !config.checkedAt) return Response.json({ points: [] });
  const rows = await prisma.ozonDeliveryPoint.findMany({ where: { clientId: config.clientId, methodId: BigInt(config.shipmentMethodId), active: true, address: { contains: search, mode: "insensitive" } }, select: { id: true, name: true, address: true, type: true, latitude: true, longitude: true }, orderBy: { address: "asc" }, take: 201 });
  const points = rows.slice(0, 200);
  const inactive = new Set<string>();
  // Existing directories predate coordinate storage. Fill only the searched
  // public points, without sending recipient data or restarting the full sync.
  const missing = points.filter(point => !hasPointCoordinates(point));
  if (missing.length && config.clientSecret) {
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
  return Response.json({ points: points.filter(point => !inactive.has(point.id)), truncated: rows.length > 200 }, { headers: { "Cache-Control": "private, no-store" } });
}
