import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { sendTransactionalMail } from "@/lib/smtp/client";
import { getSmtpConfig, SMTP_KEY } from "@/lib/smtp/config";
import { SESSION_COOKIE } from "@/lib/auth";

const BINDING_COOKIE = "3dp_admin_login";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

// This switch is intentionally off until SMTP delivery, administrator mailbox
// ownership, and a recovery procedure have all been verified.
export async function adminEmailProtectionEnabled() {
  const setting = await prisma.siteSetting.findUnique({ where: { key: "security.admin_email_confirmation" } });
  return setting?.value === true;
}

export async function beginAdminLogin(user: { id: string; email: string; passwordHash: string }, returnTo: string, purpose: "login" | "enroll" = "login") {
  const token = randomBytes(32).toString("base64url");
  const binding = randomBytes(32).toString("base64url");
  const store = await cookies();
  const existingSession = store.get(SESSION_COOKIE)?.value;
  const smtp = purpose === "enroll" ? await getSmtpConfig() : null;
  if (purpose === "enroll" && (!existingSession || !smtp?.password || !smtp.checkedAt)) return false;
  const now = new Date();
  const challenge = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"admin-login:" + user.id}))`;
    const recent = await tx.adminLoginChallenge.count({ where: { userId: user.id, createdAt: { gt: new Date(now.getTime() - 15 * 60000) } } });
    if (recent >= 5) return null;
    await tx.adminLoginChallenge.deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date(now.getTime() - 86400000) } } });
    await tx.adminLoginChallenge.updateMany({ where: { userId: user.id, consumedAt: null }, data: { consumedAt: now } });
    return tx.adminLoginChallenge.create({ data: { tokenHash: digest(token), bindingHash: digest(binding), userId: user.id, email: user.email, passwordFingerprint: digest(user.passwordHash), returnTo, purpose, sessionHash: purpose === "enroll" && existingSession ? digest(existingSession) : null, smtpRevision: smtp?.revision ?? null, expiresAt: new Date(now.getTime() + 10 * 60000) } });
  });
  if (!challenge) return false;
  store.set(BINDING_COOKIE, binding, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600 });
  try {
    await sendTransactionalMail({ to: user.email, subject: "Подтверждение входа в SIDZEN", text: `${purpose === "enroll" ? "Подтвердите включение входа по письму" : "Подтвердите вход"} в том же браузере в течение 10 минут:\nhttps://sidzen.shop/admin-login-confirm/${purpose === "enroll" ? "?enroll=1" : ""}#${token}\nЕсли вы не выполняли это действие, проигнорируйте письмо.` });
    return true;
  } catch {
    await prisma.adminLoginChallenge.updateMany({ where: { id: challenge.id, consumedAt: null }, data: { consumedAt: new Date() } });
    store.delete(BINDING_COOKIE);
    return false;
  }
}

export async function consumeAdminLogin(token: string, expectedPurpose: "login" | "enroll") {
  const store = await cookies();
  const binding = store.get(BINDING_COOKIE)?.value ?? "";
  if (!TOKEN_RE.test(token) || !TOKEN_RE.test(binding)) return null;
  const sessionToken = randomBytes(32).toString("base64url");
  const result = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412051)`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412049)`;
    const first = await tx.adminLoginChallenge.findUnique({ where: { tokenHash: digest(token) }, select: { userId: true } });
    if (!first) return null;
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${first.userId} FOR UPDATE`;
    const now = new Date();
    const challenge = await tx.adminLoginChallenge.findUnique({ where: { tokenHash: digest(token) }, include: { user: { include: { roles: { include: { role: { include: { permissions: true } } } } } } } });
    if (!challenge || challenge.purpose !== expectedPurpose || challenge.bindingHash !== digest(binding) || challenge.consumedAt || challenge.expiresAt <= now ||
      !challenge.user.isActive || challenge.user.email !== challenge.email || digest(challenge.user.passwordHash) !== challenge.passwordFingerprint ||
      !challenge.user.roles.some(({ role }) => role.code === "superadmin" || role.permissions.length > 0)) return null;
    const setting = await tx.siteSetting.findUnique({ where: { key: "security.admin_email_confirmation" } });
    const enabled = setting?.value === true;
    if (challenge.purpose === "login" && !enabled) return null;
    if (challenge.purpose === "enroll") {
      if (enabled || !challenge.user.roles.some(({ role }) => role.code === "superadmin")) return null;
      const currentSession = store.get(SESSION_COOKIE)?.value;
      if (!currentSession || !challenge.sessionHash || digest(currentSession) !== challenge.sessionHash) return null;
      const originalSession = await tx.session.findUnique({ where: { tokenHash: challenge.sessionHash } });
      if (!originalSession || originalSession.userId !== challenge.userId || originalSession.expiresAt <= now) return null;
      const smtpSetting = await tx.siteSetting.findUnique({ where: { key: SMTP_KEY } });
      const smtpValue = smtpSetting?.value;
      if (!smtpValue || typeof smtpValue !== "object" || Array.isArray(smtpValue) || !("revision" in smtpValue) || smtpValue.revision !== challenge.smtpRevision || !("checkedAt" in smtpValue) || !smtpValue.checkedAt || !("password" in smtpValue) || !smtpValue.password) return null;
      const others = await tx.user.count({ where: { id: { not: challenge.userId }, isActive: true, roles: { some: { role: { OR: [{ code: "superadmin" }, { permissions: { some: {} } }] } } } } });
      if (others) return null;
    } else if (challenge.purpose !== "login") return null;
    const consumed = await tx.adminLoginChallenge.updateMany({ where: { id: challenge.id, consumedAt: null, expiresAt: { gt: now } }, data: { consumedAt: now } });
    if (consumed.count !== 1) return null;
    if (challenge.purpose === "enroll") {
      await tx.session.updateMany({ where: { tokenHash: challenge.sessionHash!, userId: challenge.userId }, data: { adminVerifiedAt: now } });
      await tx.siteSetting.upsert({ where: { key: "security.admin_email_confirmation" }, create: { key: "security.admin_email_confirmation", group: "security", label: "Подтверждение входа по почте", value: true }, update: { value: true } });
      await tx.auditLog.create({ data: { actorId: challenge.userId, action: "security.admin-email.enable", entityType: "SiteSetting", after: { enabled: true } } });
    }
    await tx.session.create({ data: { userId: challenge.userId, tokenHash: digest(sessionToken), adminVerifiedAt: now, expiresAt: new Date(now.getTime() + 30 * 86400000) } });
    return { userId: challenge.userId, returnTo: challenge.returnTo, sessionToken };
  });
  if (result) store.delete(BINDING_COOKIE);
  return result;
}

