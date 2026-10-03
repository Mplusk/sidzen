import { timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";
import { catalogInvalidationToken } from "@/lib/marketplaces/cache-token";

export async function POST(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const expected = catalogInvalidationToken();
  if (!/^[0-9a-f]{64}$/.test(token) || !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) return new Response(null, { status: 403 });
  revalidateTag("catalog", { expire: 0 });
  return new Response(null, { status: 204 });
}
