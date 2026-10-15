"use server";
import { randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createSession, getCurrentUser, requirePermission, requireUser, SESSION_COOKIE } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/password";
import { rateLimit } from "@/lib/rate-limit";
import { operatorReady, consentDocument, privacySubject } from "@/lib/privacy";
import { encryptSecret } from "@/lib/integration-secrets";
import { authorizationUrl } from "@/lib/social/client";
import { configSchema, getSocialConfig, providerSchema, safeSocialReturn, settingKey, socialReady, siteOrigin } from "@/lib/social/config";
import { socialLoginHandoff } from "@/lib/storefront-domains";
import { hash, pendingProfile, randomToken, registerSocial, SOCIAL_COOKIE, socialConsentText, SOCIAL_CONSENT_VERSION, socialCookieOptions } from "@/lib/social/flow";
import { socialLoginEnabled } from "@/lib/social/config";

function fail(code: string): never { redirect(`/login/?error=${code}`); }
export async function startSocialLogin(form: FormData) {
  if (!socialLoginEnabled()) fail("social-unavailable");
  const requestHeaders = await headers();
  const handoff = socialLoginHandoff(requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"), siteOrigin(), safeSocialReturn(form.get("returnTo")), form.get("intent") === "link");
  if (handoff) redirect(handoff);
  const provider = providerSchema.safeParse(form.get("provider"));
  if (!provider.success) fail("social-unavailable");
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit(`social-start:${ip}`, 10, 15 * 60000).allowed) fail("rate-limit");
  if (!await operatorReady()) fail("social-operator");
  const user = await getCurrentUser();
  const linking = form.get("intent") === "link";
  if (linking && !user) fail("social-session");
  if (user && !linking) redirect("/account/profile/");
  if (user && user.passwordHash.startsWith("scrypt$") && !verifyPassword(String(form.get("password") ?? ""), user.passwordHash)) redirect("/account/profile/?social=password");
  if (form.get("socialConsent") !== "on") fail("social-consent");
  const config = await getSocialConfig(provider.data);
  if (!socialReady(provider.data, config)) fail("social-unavailable");
  const cookieStore = await cookies();
  const old = cookieStore.get(SOCIAL_COOKIE(provider.data))?.value;
  if (old) await prisma.oAuthAttempt.deleteMany({ where: { bindingHash: hash(old) } });
  await prisma.oAuthAttempt.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  const binding = randomToken(), state = randomToken(), verifier = randomToken(), nonce = randomToken();
  const operator = (await consentDocument("account")).operator;
  await prisma.oAuthAttempt.create({ data: {
    provider: provider.data, stateHash: hash(state), bindingHash: hash(binding), configRevision: config.revision,
    verifier: encryptSecret(verifier, `oauth-verifier:${provider.data}`), nonce,
    returnTo: linking ? "/account/profile/?social=linked" : safeSocialReturn(form.get("returnTo")),
    linkUserId: linking ? user!.id : null, sessionHash: linking ? hash(cookieStore.get(SESSION_COOKIE)?.value ?? "") : null,
    consent: { version: SOCIAL_CONSENT_VERSION, purpose: `social:${provider.data}`, provider: provider.data, text: socialConsentText(provider.data), operator, url: `/legal/social-login/?provider=${provider.data}` },
    expiresAt: new Date(Date.now() + 600000),
  } });
  cookieStore.set(SOCIAL_COOKIE(provider.data), binding, socialCookieOptions);
  redirect(authorizationUrl(provider.data, config, state, verifier, nonce));
}
export async function completeSocialRegistration(form: FormData) {
  if (!socialLoginEnabled()) fail("social-unavailable");
  if (await getCurrentUser()) redirect("/account/");
  if (!await operatorReady()) fail("social-operator");
  const provider = providerSchema.safeParse(form.get("provider"));
  if (!provider.success) fail("social-expired");
  const target = `/login/social/?provider=${provider.data}`;
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit(`social-register:${ip}`, 5, 15 * 60000).allowed) fail("rate-limit");
  if (form.get("privacyConsent") !== "on") redirect(`${target}&error=consent`);
  const parsed = z.object({ email: z.email().max(254).transform(v => v.toLowerCase().trim()), name: z.string().trim().min(2).max(120), password: z.union([z.literal(""), z.string().min(10).max(200)]) }).safeParse({ email: form.get("email"), name: form.get("name"), password: form.get("password") ?? "" });
  if (!parsed.success) redirect(`${target}&error=invalid`);
  const store = await cookies(), binding = store.get(SOCIAL_COOKIE(provider.data))?.value ?? "";
  const pending = await pendingProfile(provider.data, binding);
  if (!pending) fail("social-expired");
  let userId: string;
  try { userId = await registerSocial(pending.attempt.id, binding, parsed.data, await consentDocument("account")); }
  catch (error) { if (error instanceof Error && error.message === "social-email-exists") redirect(`${target}&error=exists`); fail("social-failed"); }
  store.delete(SOCIAL_COOKIE(provider.data));
  await createSession(userId);
  redirect(safeSocialReturn(pending.attempt.returnTo));
}
export async function saveSocialIntegration(form: FormData) {
  const actor = await requirePermission("settings.write");
  function result(code: string): never { redirect(`/account/integrations/?result=social-${code}#social-login`); }
  if (!rateLimit(`social-settings:${actor.id}`, 15, 60000).allowed) result("rate");
  const provider = providerSchema.safeParse(form.get("provider"));
  if (!provider.success) result("invalid");
  const current = await getSocialConfig(provider.data);
  const clientId = String(form.get("clientId") ?? "").trim();
  const secret = form.get("clearSecret") === "on" ? "" : String(form.get("clientSecret") ?? "").trim() || (clientId === current.clientId ? current.clientSecret : "");
  const parsed = configSchema.safeParse({ enabled: form.get("enabled") === "on", clientId, clientSecret: provider.data === "vk" ? "" : secret, operatorReviewed: form.get("operatorReviewed") === "on", revision: randomUUID() });
  if (!parsed.success) result("invalid");
  if (parsed.data.enabled && (!await operatorReady() || !socialReady(provider.data, parsed.data))) result("incomplete");
  const saved = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412031)`;
    if (JSON.stringify(await getSocialConfig(provider.data, tx)) !== JSON.stringify(current)) return false;
    const key = settingKey(provider.data);
    const value = { ...parsed.data, clientSecret: parsed.data.clientSecret ? encryptSecret(parsed.data.clientSecret, key) : "" };
    await tx.siteSetting.upsert({ where: { key }, create: { key, group: "integrations", value }, update: { value, group: "integrations" } });
    await tx.oAuthAttempt.deleteMany({ where: { provider: provider.data } });
    await tx.auditLog.create({ data: { actorId: actor.id, action: "auth.social.settings", entityType: "SiteSetting", after: { provider: provider.data, enabled: parsed.data.enabled, credentialsChanged: current.clientId !== clientId || current.clientSecret !== secret, operatorReviewed: parsed.data.operatorReviewed } } });
    return true;
  });
  if (!saved) result("changed");
  revalidatePath("/", "layout"); result("saved");
}
export async function disconnectSocialAccount(form: FormData) {
  const user = await requireUser("/account/profile/");
  function done(value: string): never { redirect(`/account/profile/?social=${value}`); }
  if (!rateLimit(`social-unlink:${user.id}`, 10, 60000).allowed) done("rate");
  const id = String(form.get("id") ?? "");
  if (!id || form.get("confirmation") !== "on") done("confirmation");
  if (user.passwordHash.startsWith("scrypt$") && !verifyPassword(String(form.get("password") ?? ""), user.passwordHash)) done("password");
  const session = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  const removed = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412031)`;
    const accounts = await tx.socialAccount.findMany({ where: { userId: user.id } });
    if (!accounts.some(account => account.id === id)) return "missing";
    if (!user.passwordHash.startsWith("scrypt$")) {
      let alternatives = 0;
      for (const account of accounts.filter(account => account.id !== id)) {
        const p = providerSchema.safeParse(account.provider);
        if (p.success) { const config = await getSocialConfig(p.data, tx); if (socialReady(p.data, config) && account.clientId === config.clientId) alternatives++; }
      }
      if (!alternatives) return "last";
    }
    await tx.socialAccount.delete({ where: { id } });
    await tx.privacyConsent.updateMany({ where: { userId: user.id, purpose: `social:${accounts.find(account => account.id === id)!.provider}`, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.oAuthAttempt.deleteMany({ where: { linkUserId: user.id } });
    await tx.session.deleteMany({ where: { userId: user.id, tokenHash: { not: hash(session) } } });
    await tx.auditLog.create({ data: { actorId: user.id, action: "auth.social.unlink", entityType: "User", entityId: user.id, after: { provider: accounts.find(account => account.id === id)!.provider } } });
    return "removed";
  });
  revalidatePath("/account/profile/"); done(removed);
}

export async function setSocialPassword(form: FormData) {
  const user = await requireUser("/account/profile/");
  if (!rateLimit(`social-password:${user.id}`, 5, 60000).allowed) redirect("/account/profile/?social=rate");
  if (user.passwordHash !== "!social-only" || !await operatorReady()) redirect("/account/profile/?social=password");
  const password = z.string().min(10).max(200).safeParse(form.get("password"));
  if (!password.success || form.get("repeatPassword") !== password.data || form.get("privacyConsent") !== "on") redirect("/account/profile/?social=password");
  const session = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  const document = await consentDocument("account");
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412031)`;
    const changed = await tx.user.updateMany({ where: { id: user.id, passwordHash: "!social-only", isActive: true }, data: { passwordHash: hashPassword(password.data) } });
    if (changed.count !== 1) throw new Error("social-password-changed");
    await tx.session.deleteMany({ where: { userId: user.id, tokenHash: { not: hash(session) } } });
    await tx.privacyConsent.create({ data: { userId: user.id, purpose: "account", version: document.version, document, subjectHash: privacySubject(user.id) } });
    await tx.auditLog.create({ data: { actorId: user.id, action: "auth.password.set", entityType: "User", entityId: user.id } });
  });
  revalidatePath("/account/profile/"); redirect("/account/profile/?social=password-set");
}
