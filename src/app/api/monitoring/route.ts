import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { rfStorageReady } from "@/lib/privacy";
import { monitoringEvent, recordMonitoring } from "@/lib/monitoring";
import { MONITORING_COOKIE, monitoringOriginAllowed, readMonitoringConsent, trustedVisitorIp } from "@/lib/monitoring-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const empty = (status = 204) => new Response(null, { status, headers: { "Cache-Control": "private, no-store" } });
export async function POST(request: Request) {
  if (!monitoringOriginAllowed(request)) return empty(403);
  if (!rfStorageReady()) return empty(403);
  const consent = readMonitoringConsent((await cookies()).get(MONITORING_COOKIE)?.value);
  if (!consent || request.headers.get("dnt") === "1" || request.headers.get("sec-gpc") === "1") return empty(403);
  if (!rateLimit(`monitor:${consent.visitorHash}`, 30, 60000).allowed) return empty(429);
  try {
    if (Number(request.headers.get("content-length")) > 4096) return empty(413);
    const reader = request.body?.getReader(); if (!reader) return empty(400);
    let text = "", size = 0; const decoder = new TextDecoder();
    for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 4096) { await reader.cancel(); return empty(413); } text += decoder.decode(value, { stream: true }); }
    const parsed = monitoringEvent.safeParse(JSON.parse(text + decoder.decode())); if (!parsed.success) return empty(400);
    const user = await getCurrentUser();
    if (user && (user.roles.some(role => role !== "customer") || user.permissions.size)) return empty();
    await recordMonitoring(consent, parsed.data, { ip: trustedVisitorIp(request.headers), agent: (request.headers.get("user-agent") ?? "").slice(0, 512), userId: user?.id });
    return empty();
  } catch (error) { return empty(error instanceof Error && error.message === "Statistics consent expired" ? 403 : 503); } // Never log raw requests, cookies or IPs on failure.
}
