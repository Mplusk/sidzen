import { readFile } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { publicReviewWhere } from "@/lib/reviews";
import { reviewImagePath } from "@/lib/review-images";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow", "Vary": "Cookie" };
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return new Response(null, { status: 404, headers });
  const image = await prisma.reviewImage.findUnique({ where: { id }, include: { review: { select: { id: true, userId: true } } } });
  if (!image) return new Response(null, { status: 404, headers });
  const visible = await prisma.review.count({ where: { id: image.reviewId, ...publicReviewWhere } });
  if (!visible) {
    const user = await getCurrentUser();
    if (!user || (user.id !== image.review.userId && !user.permissions.has("content.write") && !user.roles.includes("superadmin"))) return new Response(null, { status: 404, headers });
  }
  try {
    const bytes = await readFile(reviewImagePath(image.fileName));
    return new Response(new Uint8Array(bytes), { headers: { ...headers, "Content-Type": "image/webp", "Content-Length": String(bytes.length) } });
  } catch { return new Response(null, { status: 404, headers }); }
}
