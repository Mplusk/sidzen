import { stat } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse, type NextRequest } from "next/server";

// next.config headers run before public-file routing. Prevent their immutable
// policy from being applied to a missing file (route headers cannot override it).
const immutableUpload = /^\/uploads\/products\/((?:mp-[0-9a-f]{64}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(?:jpg|png|webp|avif))$/;
export async function proxy(request: NextRequest) {
  const name = request.nextUrl.pathname.match(immutableUpload)?.[1];
  if (!name) return NextResponse.next();
  try {
    if ((await stat(join(process.cwd(), "public", "uploads", "products", name))).isFile()) return NextResponse.next();
    return new NextResponse(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const status = (error as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 500;
    return new NextResponse(null, { status, headers: { "Cache-Control": "private, no-store" } });
  }
}

export const config = { matcher: "/uploads/products/:name" };
