"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { encryptSecret } from "@/lib/integration-secrets";
import { checkYookassa, deliveryConfigSchema, getPaymentConfig, PAYMENT_SETTING, paymentConfigSchema } from "@/lib/integrations";

const path = "/account/integrations/";
function result(code: string): never { redirect(`${path}?result=${code}`); }

export async function savePaymentIntegration(form: FormData) {
  const user = await requirePermission("settings.write");
  if (!rateLimit(`integrations:${user.id}`, 10, 60_000).allowed) result("rate");
  const current = await getPaymentConfig();
  const secret = String(form.get("secret") ?? "").trim() || current.secret;
  const parsed = paymentConfigSchema.safeParse({ enabled: form.get("enabled") === "on", shopId: String(form.get("shopId") ?? "").trim(), secret, receiptMode: form.get("receiptMode"), vatCode: String(form.get("vatCode") ?? ""), taxSystemCode: String(form.get("taxSystemCode") ?? "") });
  if (!parsed.success) result("invalid");
  const config = parsed.data;
  if (config.enabled && (!config.shopId || !secret || (config.receiptMode !== "external" && !config.vatCode))) result("incomplete");
  const credentialsChanged = config.shopId !== current.shopId || secret !== current.secret;
  if (config.enabled || credentialsChanged || form.get("intent") === "check") {
    try { await checkYookassa(config); } catch { result("connection"); }
    config.checkedAt = new Date().toISOString();
  } else config.checkedAt = current.checkedAt;
  // Serialize configuration changes with other saves. Never replace the merchant
  // while there are payments that still need reconciliation.
  const saved = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412026)`;
    if (JSON.stringify(await getPaymentConfig(tx)) !== JSON.stringify(current)) return false;
    if (credentialsChanged && await tx.payment.count({ where: { provider: "yookassa", status: { in: ["PENDING", "AUTHORIZED"] } } })) return false;
    const value = { ...config, secret: secret ? encryptSecret(secret, PAYMENT_SETTING) : "" };
    await tx.siteSetting.upsert({ where: { key: PAYMENT_SETTING }, create: { key: PAYMENT_SETTING, group: "integrations", value }, update: { value, group: "integrations" } });
    await tx.auditLog.create({ data: { actorId: user.id, action: "integration.payment.update", entityType: "SiteSetting", after: { enabled: config.enabled, shopId: config.shopId, credentialsChanged } } });
    return true;
  });
  if (!saved) result("pending");
  revalidatePath("/", "layout");
  result(config.checkedAt ? "verified" : "saved");
}

export async function saveDeliveryMethod(form: FormData) {
  const user = await requirePermission("settings.write");
  const id = String(form.get("id") ?? "");
  const parsed = deliveryConfigSchema.safeParse({ name: form.get("name"), description: form.get("description"), basePrice: form.get("basePrice"), sortOrder: form.get("sortOrder"), active: form.get("active") === "on" });
  if (!parsed.success) result("invalid");
  if (id && !await prisma.deliveryMethod.findUnique({ where: { id } })) result("invalid");
  await prisma.$transaction(async (tx) => {
    const method = id ? await tx.deliveryMethod.update({ where: { id }, data: parsed.data }) : await tx.deliveryMethod.create({ data: { ...parsed.data, code: `custom-${randomUUID()}` } });
    await tx.auditLog.create({ data: { actorId: user.id, action: "integration.delivery.update", entityType: "DeliveryMethod", entityId: method.id, after: parsed.data } });
  });
  revalidatePath("/", "layout");
  result("saved");
}
