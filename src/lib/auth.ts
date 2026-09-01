import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

export const SESSION_COOKIE = "3dp_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const headerStore = await headers();
  await prisma.session.create({
    data: {
      userId,
      tokenHash: tokenHash(token),
      expiresAt: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000),
      ip: headerStore.get("x-forwarded-for")?.split(",")[0]?.trim(),
      userAgent: headerStore.get("user-agent")?.slice(0, 500),
    },
  });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function destroySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: tokenHash(token) } });
  cookieStore.delete(SESSION_COOKIE);
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

export async function requirePermission(permission: string) {
  const user = await requireUser("/admin");
  if (!user.permissions.has(permission) && !user.roles.includes("superadmin")) redirect("/account?error=forbidden");
  return user;
}
