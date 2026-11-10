import { getMapTile } from "@/lib/map-tiles";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(request: Request, context: { params: Promise<{ z: string; x: string; y: string }> }) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  // Each ordinary map view needs dozens of images. Allow navigation while
  // bounding both rapid bursts and sustained requests, including cache hits.
  const retryAfter = !rateLimit(`map-tiles:burst:${ip}`, 120, 10_000).allowed ? "10"
    : !rateLimit(`map-tiles:minute:${ip}`, 600, 60_000).allowed ? "60" : null;
  if (retryAfter) return new Response(null, { status: 429, headers: { "Retry-After": retryAfter, "Cache-Control": "no-store" } });
  const { z, x, y } = await context.params;
  return getMapTile(z, x, y);
}
