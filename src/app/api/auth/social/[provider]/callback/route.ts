import { cookies } from "next/headers";
import { createSession, getCurrentUser, SESSION_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { operatorReady } from "@/lib/privacy";
import { decryptSecret } from "@/lib/integration-secrets";
import { rateLimit } from "@/lib/rate-limit";
import { getSocialConfig, providerSchema, siteOrigin, socialReady, safeSocialReturn } from "@/lib/social/config";
import { exchangeProfile } from "@/lib/social/client";
import { claimCallback, resolveIdentity, SOCIAL_COOKIE } from "@/lib/social/flow";
import { writeDiagnostic } from "@/lib/diagnostics";

export const runtime = "nodejs";
function go(path: string) { return new Response(null, { status: 303, headers: { Location: new URL(path, siteOrigin()).toString(), "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } }); }
export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const parsed = providerSchema.safeParse((await context.params).provider);
  if (!parsed.success) return go("/login/?error=social-unavailable");
  const provider = parsed.data, store = await cookies();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit(`social-callback:${ip}`, 20, 60000).allowed) return go("/login/?error=rate-limit");
  let attemptId: string | undefined;
  try {
    if (!await operatorReady()) throw new Error("social-operator");
    const params = new URL(request.url).searchParams;
    if (["state", "code", "device_id", "error"].some(key => params.getAll(key).length > 1)) throw new Error("social-expired");
    const attempt = await claimCallback(provider, params.get("state") ?? "", store.get(SOCIAL_COOKIE(provider))?.value ?? "");
    attemptId = attempt.id;
    if (params.has("error")) throw new Error("social-canceled");
    const code = params.get("code") ?? "";
    if (!code || code.length > 4096) throw new Error("social-failed");
    const config = await getSocialConfig(provider);
    if (!socialReady(provider, config) || config.revision !== attempt.configRevision) throw new Error("social-disabled");
    const profile = await exchangeProfile(provider, config, { code, verifier: decryptSecret(attempt.verifier, `oauth-verifier:${provider}`), nonce: attempt.nonce, state: params.get("state")!, deviceId: params.get("device_id") ?? "" });
    const user = await getCurrentUser();
    const outcome = await resolveIdentity(attempt, profile, user?.id ?? null, store.get(SESSION_COOKIE)?.value ?? "");
    await writeDiagnostic("social.ok", { provider });
    if (outcome.kind === "register") return go(`/login/social/?provider=${provider}`);
    store.delete(SOCIAL_COOKIE(provider));
    if (outcome.kind === "login") await createSession(outcome.userId);
    return go(safeSocialReturn(attempt.returnTo));
  } catch (error) {
    if (attemptId) { await prisma.oAuthAttempt.deleteMany({ where: { id: attemptId } }); store.delete(SOCIAL_COOKIE(provider)); }
    const message = error instanceof Error ? error.message : "";
    const publicCode = ["social-expired", "social-canceled", "social-operator", "social-conflict", "social-link-session"].includes(message) ? message : "social-failed";
    await writeDiagnostic(publicCode === "social-canceled" ? "social.canceled" : "social.failed", { provider, reason: publicCode });
    return go(`/login/?error=${publicCode}`);
  }
}
