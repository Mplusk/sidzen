"use server";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { encryptSecret } from "@/lib/integration-secrets";
import { CATEGORY_AI_KEY, categoryAiConfigSchema, getCategoryAiConfig } from "@/lib/category-ai/config";
import { verifyCategoryAi } from "@/lib/category-ai/client";

export async function saveCategoryAiConfig(form: FormData) {
  const actor = await requirePermission(PERMISSIONS.settingsWrite);
  const result = (code: string): never => redirect(`/account/integrations/?result=ai-${code}#category-ai`);
  if (!rateLimit(`category-ai-config:${actor.id}`, 5, 60_000).allowed) result("rate");
  const current = await getCategoryAiConfig();
  const suppliedKey = String(form.get("apiKey") ?? "").trim();
  if (suppliedKey && !/^[A-Za-z0-9._-]{16,512}$/.test(suppliedKey)) result("invalid");
  const apiKey = form.get("clearKey") === "on" ? "" : suppliedKey || current.apiKey;
  const parsed = categoryAiConfigSchema.safeParse({ enabled: form.get("enabled") === "on", apiKey, model: form.get("model"), allowCreate: form.get("allowCreate") === "on", revision: randomUUID(), checkedAt: null });
  if (!parsed.success) return result("invalid");
  const data = parsed.data;
  if (data.enabled || form.get("verify") === "yes") {
    if (!apiKey) result("incomplete");
    try { await verifyCategoryAi(data); } catch { result("connection"); }
    data.checkedAt = new Date().toISOString();
  }
  const saved = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412027)`;
    if ((await getCategoryAiConfig(tx)).revision !== String(form.get("revision") ?? "")) return false;
    const stored = { ...data, apiKey: apiKey ? encryptSecret(apiKey, CATEGORY_AI_KEY) : "" };
    await tx.siteSetting.upsert({ where: { key: CATEGORY_AI_KEY }, create: { key: CATEGORY_AI_KEY, group: "integrations", label: "DeepSeek · категории товаров", value: stored }, update: { value: stored, group: "integrations" } });
    await tx.auditLog.create({ data: { actorId: actor.id, action: "integration.category-ai.update", entityType: "SiteSetting", after: { enabled: data.enabled, model: data.model, allowCreate: data.allowCreate, credentialsChanged: apiKey !== current.apiKey, checked: Boolean(data.checkedAt) } } });
    return true;
  });
  if (!saved) result("changed");
  revalidatePath("/account/integrations/"); revalidatePath("/admin/products/new/");
  result("saved");
}
