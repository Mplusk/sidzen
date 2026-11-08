import { getYandexMapsConfig } from "@/lib/yandex-maps/config";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  if (!rateLimit(`map-config:${ip}`, 60, 60000).allowed) return new Response(null, { status: 429, headers: { "Retry-After": "60" } });
  // A browser API key is necessarily public; domain restrictions are configured in Yandex.
  try {
    const { apiKey } = await getYandexMapsConfig();
    return Response.json({ apiKey }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    // A disabled or damaged optional integration must not block checkout.
    return Response.json({ apiKey: "" }, { headers: { "Cache-Control": "private, no-store" } });
  }
}
