import { LEGACY_MONITORING_COOKIE, monitoringOriginAllowed } from "@/lib/monitoring-policy";
export function POST(request: Request) {
  if (!monitoringOriginAllowed(request)) return new Response(null, { status: 403 });
  // Only expires an old cookie; ?choice=allow cannot create an identity.
  return new Response(null, { status: 204, headers: {
    "Cache-Control": "private, no-store",
    "Set-Cookie": `${LEGACY_MONITORING_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
  } });
}
