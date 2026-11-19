import type { NextRequest } from "next/server";
import { publicMonitoringPath } from "@/lib/monitoring-policy";
import { isTopMailEnabled } from "@/lib/settings";
import { TOP_MAIL_COOKIE, TOP_MAIL_ID } from "@/lib/top-mail";

export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "private, no-store",
  "Content-Type": "text/html; charset=utf-8",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const path = publicMonitoringPath(params.get("page") ?? "");
  const destination = request.headers.get("sec-fetch-dest");
  if (!path || params.size !== 1 || request.cookies.get(TOP_MAIL_COOKIE)?.value !== "1" ||
      request.headers.get("dnt") === "1" || request.headers.get("sec-gpc") === "1" ||
      request.headers.get("sec-fetch-site") === "cross-site" || (destination && destination !== "iframe")) {
    return new Response(null, { status: 204, headers });
  }

  // A tab may have kept its root layout since before an administrator switched the counter off.
  if (!await isTopMailEnabled()) return new Response(null, { status: 204, headers });
  const url = new URL(path, process.env.NEXT_PUBLIC_SITE_URL ?? "https://sidzen.shop").href;
  return new Response(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>SIDZEN</title>
<script>window._tmr = [{id: ${TOP_MAIL_ID}, type: "pageView", start: Date.now(), url: ${JSON.stringify(url)}, referrer: ""}];</script>
<script async id="tmr-code" src="https://top-fwz1.mail.ru/js/code.js"></script></head>
<body><noscript><img width="1" height="1" alt="" src="https://top-fwz1.mail.ru/counter?id=${TOP_MAIL_ID};js=na;u=${encodeURIComponent(url)}"></noscript></body></html>`, { headers });
}
