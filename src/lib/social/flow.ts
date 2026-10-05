import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { encryptSecret, decryptSecret } from "@/lib/integration-secrets";
import { hashPassword } from "@/lib/password";
import { privacySubject } from "@/lib/privacy";
import { CONSENT_VERSION } from "@/lib/privacy-documents";
import { getSocialConfig, socialReady, type SocialProvider } from "./config";
import { profileSchema, type SocialProfile } from "./client";

export const SOCIAL_COOKIE = (provider: SocialProvider) => `${process.env.NODE_ENV === "production" ? "__Host-" : ""}3dp_oauth_${provider}`;
export const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const randomToken = () => randomBytes(32).toString("base64url");
export const socialCookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 600 };
export async function claimCallback(provider: SocialProvider, state: string, binding: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(binding)) throw new Error("social-expired");
  const attempt = await prisma.oAuthAttempt.findUnique({ where: { stateHash: hash(state) } });
  if (!attempt || attempt.provider !== provider || attempt.bindingHash !== hash(binding) || attempt.expiresAt <= new Date() || attempt.stage !== "STARTED") throw new Error("social-expired");
  const claimed = await prisma.oAuthAttempt.updateMany({ where: { id: attempt.id, stage: "STARTED", expiresAt: { gt: new Date() } }, data: { stage: "EXCHANGING" } });
  if (claimed.count !== 1) throw new Error("social-expired");
  return attempt;
}
export async function pendingProfile(provider: SocialProvider, binding: string) {
  if (!binding) return null;
  const attempt = await prisma.oAuthAttempt.findUnique({ where: { bindingHash: hash(binding) } });
  if (!attempt || attempt.provider !== provider || attempt.linkUserId || attempt.stage !== "PROFILE" || !attempt.profile || attempt.expiresAt <= new Date()) return null;
  const config = await getSocialConfig(provider);
  if (!socialReady(provider, config) || config.revision !== attempt.configRevision) return null;
  return { attempt, profile: profileSchema.parse(JSON.parse(decryptSecret(attempt.profile, `oauth-profile:${attempt.id}`))) };
}
type Attempt = Awaited<ReturnType<typeof claimCallback>>;
// Serialize finalizations with configuration changes. Email NEVER links identities.
export async function resolveIdentity(attempt: Attempt, profile: SocialProfile, currentUserId: string | null, currentSession: string) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412031)`;
    const provider = attempt.provider as SocialProvider;
    const config = await getSocialConfig(provider, tx);
    if (!socialReady(provider, config) || config.revision !== attempt.configRevision) throw new Error("social-disabled");
    const row = await tx.oAuthAttempt.findUnique({ where: { id: attempt.id } });
    if (!row || row.stage !== "EXCHANGING" || row.expiresAt <= new Date()) throw new Error("social-expired");
    const key = { provider, clientId: config.clientId, subject: profile.subject };
    const account = await tx.socialAccount.findUnique({ where: { provider_clientId_subject: key }, include: { user: true } });
    if (attempt.linkUserId) {
      if (attempt.linkUserId !== currentUserId || !currentSession || attempt.sessionHash !== hash(currentSession)) throw new Error("social-link-session");
      const session = await tx.session.findUnique({ where: { tokenHash: hash(currentSession) } });
      if (!session || session.userId !== currentUserId || session.expiresAt <= new Date()) throw new Error("social-link-session");
      const user = await tx.user.findUnique({ where: { id: currentUserId } });
      if (!user?.isActive || (account && account.userId !== user.id)) throw new Error("social-conflict");
      const other = await tx.socialAccount.findUnique({ where: { userId_provider_clientId: { userId: user.id, provider, clientId: config.clientId } } });
      if (other && other.subject !== profile.subject) throw new Error("social-conflict");
      if (!account) await tx.socialAccount.create({ data: { ...key, userId: user.id } });
      await tx.privacyConsent.create({ data: { userId: user.id, purpose: `social:${provider}`, version: SOCIAL_CONSENT_VERSION, document: attempt.consent as Prisma.InputJsonValue, subjectHash: privacySubject(user.id, provider) } });
      await tx.auditLog.create({ data: { actorId: user.id, action: "auth.social.link", entityType: "User", entityId: user.id, after: { provider } } });
      await tx.oAuthAttempt.delete({ where: { id: attempt.id } });
      return { kind: "linked" as const, userId: user.id };
    }
    // Do not switch an already authenticated browser to a different account.
    if (currentUserId) throw new Error("social-already-authenticated");
    if (account) {
      if (!account.user.isActive) throw new Error("social-inactive");
      await tx.privacyConsent.create({ data: { userId: account.userId, purpose: `social:${provider}`, version: SOCIAL_CONSENT_VERSION, document: attempt.consent as Prisma.InputJsonValue, subjectHash: privacySubject(account.userId, provider) } });
      await tx.oAuthAttempt.delete({ where: { id: attempt.id } });
      return { kind: "login" as const, userId: account.userId };
    }
    await tx.oAuthAttempt.update({ where: { id: attempt.id }, data: { stage: "PROFILE", verifier: "", nonce: "", profile: encryptSecret(JSON.stringify(profileSchema.parse(profile)), `oauth-profile:${attempt.id}`) } });
    return { kind: "register" as const };
  });
}
export const SOCIAL_CONSENT_VERSION = "2026-10-05-social-v1";
export function socialConsentText(provider: SocialProvider) {
  const label = { google: "Google (Google LLC, иностранный сервис)", vk: "VK ID (ООО «ВК»)", yandex: "Яндекс ID (ООО «ЯНДЕКС»)" }[provider];
  return `Я добровольно выбираю вход через ${label} и разрешаю магазину получить и обработать идентификатор моего аккаунта, имя и email только для входа, создания или привязки личного кабинета. При переходе сервис получает IP-адрес моего браузера, сведения устройства, адрес возврата в магазин и случайные параметры защиты входа. Магазин не передаёт ему мои заказы, телефон, адрес доставки или пароль. Действия магазина: сбор, запись, хранение, использование, уточнение и удаление. Временная попытка входа действует 10 минут. Привязка действует до отключения в профиле или отзыва через раздел «Персональные данные» / контакты оператора. Можно пользоваться обычным входом без этого согласия. Правила выбранного сервиса действуют на его странице. Рекламных рассылок нет.`;
}
export async function registerSocial(attemptId: string, binding: string, data: { email: string; name: string; password: string }, document: Prisma.InputJsonValue) {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412031)`;
    const attempt = await tx.oAuthAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt || attempt.bindingHash !== hash(binding) || attempt.stage !== "PROFILE" || attempt.linkUserId || !attempt.profile || attempt.expiresAt <= new Date()) throw new Error("social-expired");
    const provider = attempt.provider as SocialProvider;
    const config = await getSocialConfig(provider, tx);
    if (!socialReady(provider, config) || config.revision !== attempt.configRevision) throw new Error("social-disabled");
    const profile = profileSchema.parse(JSON.parse(decryptSecret(attempt.profile, `oauth-profile:${attempt.id}`)));
    if (await tx.user.findUnique({ where: { email: data.email } })) throw new Error("social-email-exists");
    const role = await tx.role.findUnique({ where: { code: "customer" } });
    if (!role) throw new Error("social-role-missing");
    const user = await tx.user.create({ data: {
      email: data.email, name: data.name, passwordHash: data.password ? hashPassword(data.password) : "!social-only",
      // Email is contact information, never proof of ownership or account-linking.
      roles: { create: { roleId: role.id } },
      socialAccounts: { create: { provider, clientId: config.clientId, subject: profile.subject } },
      privacyConsents: { create: [
        { purpose: "account", version: CONSENT_VERSION, document, subjectHash: privacySubject(data.email) },
        { purpose: `social:${provider}`, version: SOCIAL_CONSENT_VERSION, document: attempt.consent as Prisma.InputJsonValue, subjectHash: privacySubject(data.email, provider) },
      ] },
    } });
    await tx.oAuthAttempt.delete({ where: { id: attempt.id } });
    return user.id;
  });
}
