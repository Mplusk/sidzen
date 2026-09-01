"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createSession, destroySession } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";

const credentialsSchema = z.object({ email: z.email().transform((value) => value.toLowerCase().trim()), password: z.string().min(10).max(200) });

function safeReturnTo(value: FormDataEntryValue | null, fallback: string) {
  const path = String(value ?? "");
  return path.startsWith("/") && !path.startsWith("//") ? path : fallback;
}

export async function loginAction(formData: FormData) {
  const parsed = credentialsSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  const returnTo = safeReturnTo(formData.get("returnTo"), "/account/");
  if (!parsed.success) redirect(`/login/?error=invalid&returnTo=${encodeURIComponent(returnTo)}`);
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit(`login:${ip}`, 10, 15 * 60 * 1000).allowed) redirect("/login/?error=rate-limit");
  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || !user.isActive || !verifyPassword(parsed.data.password, user.passwordHash)) redirect(`/login/?error=invalid&returnTo=${encodeURIComponent(returnTo)}`);
  await createSession(user.id);
  redirect(returnTo);
}

export async function registerAction(formData: FormData) {
  const parsed = credentialsSchema.extend({ name: z.string().trim().min(2).max(120), phone: z.string().trim().min(7).max(30).optional() }).safeParse({ email: formData.get("email"), password: formData.get("password"), name: formData.get("name"), phone: formData.get("phone") || undefined });
  if (!parsed.success) redirect("/register/?error=invalid");
  const exists = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (exists) redirect("/login/?error=exists");
  const customerRole = await prisma.role.findUnique({ where: { code: "customer" } });
  const user = await prisma.user.create({ data: { email: parsed.data.email, passwordHash: hashPassword(parsed.data.password), name: parsed.data.name, phone: parsed.data.phone, emailVerified: new Date(), roles: customerRole ? { create: { roleId: customerRole.id } } : undefined } });
  await createSession(user.id);
  redirect("/account/");
}

export async function logoutAction() {
  await destroySession();
  redirect("/");
}

export async function updateProfileAction(formData: FormData) {
  const { requireUser } = await import("@/lib/auth");
  const user = await requireUser();
  const parsed = z.object({ name: z.string().trim().min(2).max(120), phone: z.string().trim().max(30), company: z.string().trim().max(180), taxId: z.string().trim().max(20) }).safeParse({ name: formData.get("name"), phone: formData.get("phone") ?? "", company: formData.get("company") ?? "", taxId: formData.get("taxId") ?? "" });
  if (!parsed.success) redirect("/account/profile/?error=invalid");
  await prisma.user.update({ where: { id: user.id }, data: parsed.data });
  redirect("/account/profile/?saved=1");
}
