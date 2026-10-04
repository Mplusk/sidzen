import { getMapTile } from "@/lib/map-tiles";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(request: Request, context: { params: Promise<{ z: string; x: string; y: string }> }) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  if (!rateLimit(`map-tiles:${ip}`, 240, 60000).allowed) return new Response(null, { status: 429, headers: { "Retry-After": "60" } });
  const { z, x, y } = await context.params;
  return getMapTile(z, x, y);
}
