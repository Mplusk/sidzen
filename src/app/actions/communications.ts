"use server";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { encryptSecret } from "@/lib/integration-secrets";
import { TELEGRAM_KEY, getTelegramConfig, telegramConfigSchema } from "@/lib/telegram/config";
import { verifyTelegram, sendTelegram } from "@/lib/telegram/client";
import { REVIEW_AI_KEY, getReviewAiConfig, reviewTransferApproved } from "@/lib/review-ai/config";
import { getCategoryAiConfig } from "@/lib/category-ai/config";
const result = (code: string): never => redirect(`/account/integrations/?result=${code}#communications`);
export async function saveTelegramSettings(form: FormData) {
  const actor = await requirePermission("settings.write");
  if (!rateLimit(`telegram-settings:${actor.id}`, 5, 60000).allowed) result("communications-rate");
  const current = await getTelegramConfig();
  const token = form.get("clearToken") === "on" ? "" : String(form.get("token") ?? "").trim() || current.token;
  const chatId = String(form.get("chatId") ?? "").trim();
  if ((token && !/^\d{5,20}:[A-Za-z0-9_-]{20,120}$/.test(token)) || (chatId && !/^-?[1-9]\d{0,19}$/.test(chatId))) result("telegram-invalid");
  const data = telegramConfigSchema.parse({ enabled: form.get("enabled") === "on", token, chatId, revision: randomUUID(), checkedAt: null });
  if (data.enabled || form.get("verify") === "yes") {
    if (!token || !chatId) result("telegram-invalid");
    try { await verifyTelegram(data); } catch { result("telegram-connection"); }
    data.checkedAt = new Date().toISOString();
  }
  const saved = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412041)`;
    if ((await getTelegramConfig(tx)).revision !== String(form.get("revision") ?? "")) return false;
    const value = { ...data, token: token ? encryptSecret(token, TELEGRAM_KEY) : "" };
    await tx.siteSetting.upsert({ where: { key: TELEGRAM_KEY }, create: { key: TELEGRAM_KEY, group: "integrations", label: "Telegram · новые заказы", value }, update: { value } });
    await tx.auditLog.create({ data: { actorId: actor.id, action: "integration.telegram.update", entityType: "SiteSetting", after: { enabled: data.enabled, checked: !!data.checkedAt, credentialsChanged: token !== current.token } } });
    return true;
  });
  if (!saved) result("communications-changed");
  revalidatePath("/account/integrations/"); result("telegram-saved");
}
export async function testTelegramSettings() {
  const actor = await requirePermission("settings.write");
  if (!rateLimit(`telegram-test:${actor.id}`, 3, 60000).allowed) result("communications-rate");
  const config = await getTelegramConfig();
  if (!config.token || !config.chatId || !config.checkedAt) result("telegram-invalid");
  try { await sendTelegram(config, "SIDZEN · тестовое уведомление. Подключение Telegram работает. Данные покупателей не передаются."); } catch { result("telegram-connection"); }
  result("telegram-tested");
}
export async function saveReviewAiSettings(form: FormData) {
  const actor = await requirePermission("settings.write");
  if (!rateLimit(`review-ai-settings:${actor.id}`, 5, 60000).allowed) result("communications-rate");
  const enabled = form.get("enabled") === "on", operatorReviewed = form.get("operatorReviewed") === "on";
  if (enabled && !reviewTransferApproved()) result("review-ai-legal");
  if (enabled) { const ai = await getCategoryAiConfig(); if (!operatorReviewed || !ai.apiKey || !ai.checkedAt) result("review-ai-incomplete"); }
  const saved = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412032)`;
    if ((await getReviewAiConfig(tx)).revision !== String(form.get("revision") ?? "")) return false;
    const value = { enabled, operatorReviewed, revision: randomUUID() };
    await tx.siteSetting.upsert({ where: { key: REVIEW_AI_KEY }, create: { key: REVIEW_AI_KEY, group: "integrations", label: "DeepSeek · отзывы", value }, update: { value } });
    await tx.auditLog.create({ data: { actorId: actor.id, action: "integration.review-ai.update", entityType: "SiteSetting", after: { enabled, operatorReviewed } } }); return true;
  });
  if (!saved) result("communications-changed");
  revalidatePath("/account/integrations/"); result("review-ai-saved");
}

export async function retryTelegramNotifications(form: FormData) {
  const actor = await requirePermission("settings.write");
  if (form.get("confirmation") !== "on") result("telegram-confirmation");
  if (!rateLimit(`telegram-retry:${actor.id}`, 2, 60000).allowed) result("communications-rate");
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412041)`;
    const config = await getTelegramConfig(tx);
    if (!config.enabled || !config.checkedAt) result("telegram-invalid");
    await tx.telegramOrderJob.updateMany({ where: { status: { in: ["FAILED", "UNCERTAIN"] }, order: { deletedAt: null, status: { not: "CANCELED" } } }, data: { status: "PENDING", revision: config.revision, attempts: 0, errorCode: null, availableAt: new Date(), leaseToken: null, leaseUntil: null } });
    await tx.telegramOrderStatusJob.updateMany({ where: { status: { in: ["FAILED", "UNCERTAIN"] }, order: { deletedAt: null } }, data: { status: "PENDING", revision: config.revision, attempts: 0, errorCode: null, availableAt: new Date(), leaseToken: null, leaseUntil: null } });
    await tx.auditLog.create({ data: { actorId: actor.id, action: "integration.telegram.retry", entityType: "TelegramOrderJob", after: { confirmed: true } } });
  });
  revalidatePath("/account/integrations/"); result("telegram-retried");
}
