import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { mergeGuestFavorites } from "@/lib/favorites-merge";

export const SESSION_COOKIE = "3dp_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  await prisma.$transaction([
    prisma.session.create({
      data: {
        userId,
        tokenHash: tokenHash(token),
        expiresAt: new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000),
      },
    }),
    prisma.user.updateMany({ where: { id: userId, isActive: true, OR: [{ lastVisitedAt: null }, { lastVisitedAt: { lt: now } }] }, data: { lastVisitedAt: now } }),
  ]);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  // A temporary wishlist failure must not prevent a successful sign-in.
  await mergeGuestFavorites(userId).catch(() => {});
}

export async function destroySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: tokenHash(token) } });
  cookieStore.delete(SESSION_COOKIE);
  for (const cookie of cookieStore.getAll()) if (/^(?:__Host-)?3dp_oauth_/.test(cookie.name)) {
    await prisma.oAuthAttempt.deleteMany({ where: { bindingHash: tokenHash(cookie.value) } });
    cookieStore.delete(cookie.name);
  }
  // A shared browser must not retain guest order access after signing out.
  for (const cookie of cookieStore.getAll()) if (cookie.name.startsWith("3dp_order_")) cookieStore.delete(cookie.name);
}

export const getCurrentUser = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: tokenHash(token) },
    include: {
      user: {
        include: {
          roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
        },
      },
    },
  });
  if (!session || session.expiresAt < new Date() || !session.user.isActive) return null;
  const visitCutoff = new Date(Date.now() - 60 * 60 * 1000);
  if (!session.user.lastVisitedAt || session.user.lastVisitedAt < visitCutoff) {
    await prisma.user.updateMany({
      where: { id: session.user.id, isActive: true, OR: [{ lastVisitedAt: null }, { lastVisitedAt: { lt: visitCutoff } }] },
      data: { lastVisitedAt: new Date() },
    });
  }
  if (session.user.lastActiveAt && session.user.lastActiveAt.getTime() < Date.now() - 86400000) {
    await prisma.user.updateMany({ where: { id: session.user.id, lastActiveAt: { lt: new Date(Date.now() - 86400000) } }, data: { lastActiveAt: new Date() } });
  }
  const roles = session.user.roles.map(({ role }) => role.code);
  const permissions = new Set(
    session.user.roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.code)),
  );
  return { ...session.user, roles, permissions };
});

export async function requireUser(returnTo = "/account") {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  return user;
}

export async function requirePermission(permission: string, returnTo = "/admin") {
  const user = await requireUser(returnTo);
  if (!user.permissions.has(permission) && !user.roles.includes("superadmin")) redirect("/account?error=forbidden");
  return user;
}
