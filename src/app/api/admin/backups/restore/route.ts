import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { hasTrustedOrigin } from "@/lib/request-security";
import { rateLimit } from "@/lib/rate-limit";
import { restoreControl } from "@/lib/restore-control";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user?.roles.includes("superadmin") || user.adminConfirmationRequired) return new NextResponse(null, { status: 403 });
  if (!hasTrustedOrigin(request)) return new NextResponse(null, { status: 403 });
  if (!rateLimit(`restore:${user.id}`, 5, 60_000).allowed) return new NextResponse(null, { status: 429 });
  if (Number(request.headers.get("content-length") ?? 0) > 4096) return new NextResponse(null, { status: 413 });
  try {
    const text = await request.text();
    if (text.length > 4096) return new NextResponse(null, { status: 413 });
    const data = JSON.parse(text) as { id?: unknown; name?: unknown; confirmation?: unknown };
    if (typeof data.id !== "string" || !/^[0-9a-f-]{36}$/.test(data.id) || typeof data.name !== "string" || !/^sidzen-[0-9]{8}T[0-9]{6}Z\.tar\.age$/.test(data.name) || data.confirmation !== "RESTORE") {
      return new NextResponse(null, { status: 400 });
    }
    return NextResponse.json(await restoreControl({ action: "start", id: data.id, name: data.name }), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
