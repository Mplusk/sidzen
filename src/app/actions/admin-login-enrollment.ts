"use server";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { verifyPassword } from "@/lib/password";
import { adminEmailProtectionEnabled, beginAdminLogin } from "@/lib/admin-login-challenge";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";

export async function enrollAdminEmailAction(form: FormData) {
  const user = await requirePermission("settings.write", "/admin/security/");
  if (!user.roles.includes("superadmin")) redirect("/account/?error=forbidden");
  if (!rateLimit(`admin-email-enroll:${user.id}`, 5, 15 * 60000).allowed) redirect("/admin/security/?result=rate");
  const password = form.get("password");
  if (typeof password !== "string" || password.length > 200 || !verifyPassword(password, user.passwordHash)) redirect("/admin/security/?result=invalid");
  if (await adminEmailProtectionEnabled()) redirect("/admin/security/?result=already");
  const others = await prisma.user.count({ where: { id: { not: user.id }, isActive: true, roles: { some: { role: { OR: [{ code: "superadmin" }, { permissions: { some: {} } }] } } } } });
  if (others) redirect("/admin/security/?result=other-staff");
  if (!await beginAdminLogin(user, "/admin/security/", "enroll")) redirect("/admin/security/?result=unavailable");
  redirect("/admin/security/?result=sent");
}

