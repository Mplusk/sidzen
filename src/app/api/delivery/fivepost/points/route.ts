import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { fivePostDirectory } from "@/lib/delivery/fivepost-directory";
import { fivePostMapSource, scopedViewportListSql, scopedViewportSql } from "@/lib/delivery/point-viewport-sql";
import { MAX_VIEWPORT_POINTS, normalizePickupCity, parsePickupViewport, parseViewportOffset, pickupCityOverview, pickupViewportResult, type PickupViewportRow } from "@/lib/delivery/point-viewport";
import type { PickupPoint } from "@/lib/delivery/points";

function json(value: unknown, status = 200) { return Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } }); }
export async function GET(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit(`fivepost-points:${ip}`, 120, 60000).allowed) return json({ error: "Повторите через минуту." }, 429);
  const q = new URL(request.url).searchParams;
  const view = q.get("view");
  try {
    const { generation } = await fivePostDirectory();
    if (!generation) return json({ error: "Доставка 5Post временно недоступна." }, 409);
    if (view === "viewport") {
      const viewport = parsePickupViewport(q.get("bbox"), q.get("zoom"));
      const offset = viewport ? parseViewportOffset(q.get("offset"), viewport.zoom) : null;
      if (!viewport || offset === null) return json({}, 400);
      const source = fivePostMapSource(generation);
      const rows = await prisma.$queryRaw<PickupViewportRow[]>(scopedViewportSql(source, viewport, offset));
      const result = pickupViewportResult(rows.slice(0, MAX_VIEWPORT_POINTS), generation);
      if (result.clusters.length) result.listPoints = await prisma.$queryRaw<PickupPoint[]>(scopedViewportListSql(source, viewport));
      if (viewport.zoom === 18) result.nextOffset = rows.length > MAX_VIEWPORT_POINTS ? offset + MAX_VIEWPORT_POINTS : null;
      return json(result);
    }
    const cityKey = normalizePickupCity(q.get("q") ?? "");
    if (cityKey.length < 2 || cityKey.length > 120 || !/^[\p{L}\p{N}\s.'’-]+$/u.test(cityKey)) return json({ cities: [] });
    if (view === "cities") {
      const cities = await prisma.fivePostPoint.groupBy({ by: ["city", "region"], where: { generation, cityKey: { startsWith: cityKey } }, orderBy: [{ _count: { id: "desc" } }, { city: "asc" }, { region: "asc" }], take: 15 });
      return json({ cities });
    }
    const region = q.get("region") ?? "", street = (q.get("street") ?? "").trim();
    if (region.length > 180 || street.length > 150) return json({}, 400);
    const where = { generation, cityKey, region };
    if (view === "city") {
      const rows = await prisma.fivePostPoint.aggregate({ where, _min: { latitude: true, longitude: true }, _max: { latitude: true, longitude: true } });
      return json({ city: pickupCityOverview(q.get("q")!, [rows._min, rows._max]) });
    }
    if (view === "addresses") {
      const points = await prisma.fivePostPoint.findMany({ where: { ...where, address: { contains: street, mode: "insensitive" } }, select: { id: true, name: true, address: true }, orderBy: [{ address: "asc" }, { id: "asc" }], take: 25 });
      return json({ points });
    }
    return json({}, 400);
  } catch { return json({ error: "Не удалось загрузить пункты выдачи." }, 503); }
}
