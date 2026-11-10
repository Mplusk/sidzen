"use server";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { encryptSecret } from "@/lib/integration-secrets";
import { getSmtpConfig, SMTP_KEY } from "@/lib/smtp/config";
import { verifySmtp } from "@/lib/smtp/client";

const result = (code: string): never => redirect(`/account/integrations/?result=smtp-${code}#smtp`);

export async function saveSmtpSettings(form: FormData) {
  const actor = await requirePermission("settings.write");
  if (!actor.roles.includes("superadmin")) redirect("/account/?error=forbidden");
  if (!rateLimit(`smtp-settings:${actor.id}`, 5, 60000).allowed) result("rate");
  const current = await getSmtpConfig();
  const rawPassword = form.get("password");
  if (rawPassword !== null && typeof rawPassword !== "string") result("invalid");
  const supplied = typeof rawPassword === "string" ? rawPassword : "";
  const clear = form.get("clearPassword") === "on";
  if (supplied.length > 512 || /[\x00-\x1f\x7f]/.test(supplied) || (clear && supplied)) result("invalid");
  const password = clear ? "" : supplied || current.password;
  const check = form.get("verify") === "yes";
  if (check) {
    if (!password) result("invalid");
    try { await verifySmtp(password); } catch { result("connection"); }
  }
  const checkedAt = check ? new Date().toISOString() : password === current.password ? current.checkedAt : null;
  const saved = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412049)`;
    const stillSuperadmin = await tx.user.findFirst({ where: { id: actor.id, isActive: true, roles: { some: { role: { code: "superadmin" } } } }, select: { id: true } });
    if (!stillSuperadmin) return false;
    if ((await getSmtpConfig(tx)).revision !== String(form.get("revision") ?? "")) return false;
    const value = { password: password ? encryptSecret(password, SMTP_KEY) : "", checkedAt, revision: randomUUID() };
    await tx.siteSetting.upsert({ where: { key: SMTP_KEY }, create: { key: SMTP_KEY, group: "integrations", label: "SpaceWeb · исходящая почта", value }, update: { value } });
    await tx.auditLog.create({ data: { actorId: actor.id, action: "integration.smtp.update", entityType: "SiteSetting", after: { configured: Boolean(password), credentialsChanged: password !== current.password, checked: Boolean(checkedAt) } } });
    return true;
  });
  if (!saved) result("changed");
  revalidatePath("/account/integrations/");
  result(check ? "checked" : "saved");
}

