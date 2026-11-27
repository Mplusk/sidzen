import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { restoreControl } from "@/lib/restore-control";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user?.roles.includes("superadmin") || user.adminConfirmationRequired) return new NextResponse(null, { status: 403 });
  try {
    return NextResponse.json(await restoreControl({ action: "list" }), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
