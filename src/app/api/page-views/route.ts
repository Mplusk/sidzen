import { z } from "zod";
import { recordPageView } from "@/lib/monitoring";
import { monitoringOriginAllowed } from "@/lib/monitoring-policy";
import { rateLimit } from "@/lib/rate-limit";
export const dynamic = "force-dynamic";
const event = z.object({ path: z.string().max(240) }).strict();
const empty = (status = 204) => new Response(null, { status, headers: { "Cache-Control": "private, no-store" } });
export async function POST(request: Request) {
  if (!monitoringOriginAllowed(request)) return empty(403);
  if (request.headers.get("dnt") === "1" || request.headers.get("sec-gpc") === "1" || /bot|crawler|spider|headless/i.test(request.headers.get("user-agent") ?? "")) return empty();
  // One global transient limit, never an IP/cookie/account-derived key.
  // No authentication/session lookup on this endpoint.
  if (!rateLimit("aggregate-page-views", 600, 60000).allowed) return empty(429);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return empty(415);
  if (Number(request.headers.get("content-length")) > 1024) return empty(413);
  try {
    const reader = request.body?.getReader(); if (!reader) return empty(400);
    const decoder = new TextDecoder(); let text = "", size = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 1024) { await reader.cancel(); return empty(413); } text += decoder.decode(value, { stream: true }); }
    let value: unknown;
    try { value = JSON.parse(text + decoder.decode()); } catch { return empty(400); }
    const input = event.safeParse(value);
    if (!input.success) return empty(400);
    await recordPageView(input.data.path);
    return empty();
  } catch { return empty(503); } // Never log requests, headers or identifiers.
}
