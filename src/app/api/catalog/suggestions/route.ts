import { getCatalogSuggestions } from "@/lib/catalog-suggestions";
import { rateLimit } from "@/lib/rate-limit";
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2 || query.length > 120) return Response.json({ products: [] });
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  if (!rateLimit(`catalog-suggestions:${ip}`, 120, 60000).allowed) return Response.json({ products: [] }, { status: 429 });
  try { return Response.json({ products: await getCatalogSuggestions(query) }, { headers: { "Cache-Control": "public, max-age=30" } }); }
  catch { return Response.json({ products: [] }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
