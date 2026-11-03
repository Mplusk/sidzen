"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { encryptSecret } from "@/lib/integration-secrets";
import { checkYookassa } from "@/lib/integrations";
import { getYooKassaConfig, YOOKASSA_ONLINE_SETTING, yookassaConfigSchema } from "@/lib/yookassa/config";

function finish(code: string): never { redirect(`/account/integrations/?result=${code}#yookassa-online`); }
export async function saveYooKassaSettings(form: FormData) {
  const user = await requirePermission("settings.write");
  if (!rateLimit(`yookassa-settings:${user.id}`, 10, 60000).allowed) finish("yookassa-rate");
  const current = await getYooKassaConfig();
  const input = yookassaConfigSchema.safeParse({ enabled: form.get("enabled") === "on", shopId: String(form.get("shopId") ?? ""), secret: String(form.get("secret") ?? "").trim() || current.secret, receiptsConfirmed: form.get("receiptsConfirmed") === "on" });
  if (!input.success) finish("yookassa-invalid");
  const config = input.data;
  if ((config.enabled || form.get("intent") === "check") && (!config.shopId || !config.secret)) finish("yookassa-invalid");
  if (config.enabled && !config.receiptsConfirmed) finish("yookassa-receipts");
  if (config.enabled || form.get("intent") === "check") {
    try { const merchant = await checkYookassa(config); if (merchant.test && process.env.NODE_ENV === "production") throw new Error("test-merchant"); } catch { finish("yookassa-connection"); }
    config.checkedAt = new Date().toISOString();
  } else if (config.shopId === current.shopId && config.secret === current.secret) config.checkedAt = current.checkedAt;
  const saved = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412034)`;
    if (JSON.stringify(await getYooKassaConfig(tx)) !== JSON.stringify(current)) return false;
    if (current.shopId !== config.shopId && await tx.payment.count({ where: { provider: "yookassa-online", status: { in: ["PENDING", "AUTHORIZED", "PAID"] } } })) return false;
    const { checkedAt, ...rest } = config;
    const value = { ...rest, secret: config.secret ? encryptSecret(config.secret, YOOKASSA_ONLINE_SETTING) : "", ...(checkedAt ? { checkedAt } : {}) };
    await tx.siteSetting.upsert({ where: { key: YOOKASSA_ONLINE_SETTING }, create: { key: YOOKASSA_ONLINE_SETTING, group: "integrations", value }, update: { value } });
    await tx.auditLog.create({ data: { actorId: user.id, action: "integration.yookassa-online.update", entityType: "SiteSetting", after: { enabled: config.enabled, shopId: config.shopId, receiptsConfirmed: config.receiptsConfirmed, checked: Boolean(config.checkedAt) } } });
    return true;
  });
  if (!saved) finish("yookassa-changed");
  revalidatePath("/", "layout");
  finish(config.checkedAt ? "yookassa-checked" : "yookassa-saved");
}
