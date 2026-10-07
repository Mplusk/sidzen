import { headers } from "next/headers";
import { publicReviewsForHost } from "@/lib/reviews";

export async function requestPublicReviewWhere() {
  const requestHeaders = await headers();
  return publicReviewsForHost(requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"));
}
