import { consumeAdminLogin } from "@/lib/admin-login-challenge";
import { finishSession } from "@/lib/auth";
import { adminConfirmScript, adminConfirmCsp } from "@/lib/admin-confirm-document";

// A standalone document deliberately avoids the shared layout, analytics and
// application scripts. GET never uses up the one-time link.
const securityHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  // A normal form POST under no-referrer sends Origin: null in Chrome.
  // same-origin keeps the strict Origin check usable without sending the URL
  // to external sites; the fragment token is removed before submission.
  "Referrer-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": adminConfirmCsp,
};
export const dynamic = "force-dynamic";

export function GET() {
  return new Response(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Подтверждение — SIDZEN</title></head><body><main><h1>Подтверждение</h1><p id="help">Проверьте почту и откройте ссылку в том же браузере. Ссылка действует 10 минут.</p><form action="/admin-login-confirm/" method="post"><input id="token" name="token" type="hidden"><input id="intent" name="intent" type="hidden"><button id="submit" type="submit" disabled>Подтвердить</button></form><noscript>Для подтверждения необходимо включить JavaScript и открыть ссылку снова.</noscript><p><a href="/login/">Вернуться ко входу</a></p></main><script>${adminConfirmScript}</script></body></html>`, { headers: { ...securityHeaders, "Content-Type": "text/html; charset=utf-8" } });
}

async function smallBody(request: Request): Promise<string | null> {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1024) { await reader.cancel(); return null; }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  return new TextDecoder().decode(bytes);
}

export async function POST(request: Request) {
  const fail = () => new Response("Ссылка недействительна, использована или открыта в другом браузере. Начните вход заново.", { status: 400, headers: { ...securityHeaders, "Content-Type": "text/plain; charset=utf-8" } });
  if (request.headers.get("origin") !== "https://sidzen.shop" || !request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) return fail();
  const length = request.headers.get("content-length");
  if (!length || !/^\d+$/.test(length) || Number(length) > 1024) return fail();
  const body = await smallBody(request);
  if (body === null) return fail();
  const values = new URLSearchParams(body);
  const intent = values.get("intent");
  if (values.getAll("token").length !== 1 || values.getAll("intent").length !== 1 || (intent !== "login" && intent !== "enroll")) return fail();
  const challenge = await consumeAdminLogin(values.get("token") ?? "", intent);
  if (!challenge) return fail();
  await finishSession(challenge.sessionToken, challenge.userId);
  const destination = challenge.returnTo.startsWith("/") && !challenge.returnTo.startsWith("//") && !/[\\\x00-\x20\x7f]/.test(challenge.returnTo) && challenge.returnTo.length <= 1000 ? challenge.returnTo : "/account/";
  return new Response(null, { status: 303, headers: { ...securityHeaders, Location: new URL(destination, "https://sidzen.shop").toString() } });
}

