import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getOzonDeliveryConfig } from "@/lib/delivery/ozon-config";

export async function GET(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  if (!rateLimit(`ozon-points:${ip}`, 60, 60000).allowed) return Response.json({ error: "Слишком много запросов." }, { status: 429 });
  const url = new URL(request.url); const search = (url.searchParams.get("q") || "").trim();
  if (search.length < 2 || search.length > 120) return Response.json({ points: [] });
  const config = await getOzonDeliveryConfig();
  if (!config.enabled || !config.shipmentMethodId || !config.checkedAt) return Response.json({ points: [] });
  const points = await prisma.ozonDeliveryPoint.findMany({ where: { clientId: config.clientId, methodId: BigInt(config.shipmentMethodId), active: true, address: { contains: search, mode: "insensitive" } }, select: { id: true, name: true, address: true, type: true }, orderBy: { address: "asc" }, take: 50 });
  return Response.json({ points }, { headers: { "Cache-Control": "private, no-store" } });
}
