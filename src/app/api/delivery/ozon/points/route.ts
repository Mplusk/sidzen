import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getOzonDeliveryConfig } from "@/lib/delivery/ozon-config";
import { OzonDeliveryClient } from "@/lib/delivery/ozon-client";
import { hasPointCoordinates } from "@/lib/delivery/points";

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
