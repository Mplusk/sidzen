"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { encryptSecret } from "@/lib/integration-secrets";
import { deliveryConfigSchema } from "@/lib/integrations";
import { checkTochka } from "@/lib/tochka/client";
import { getTochkaConfig, TOCHKA_SETTING, tochkaConfigSchema, validProductionToken } from "@/lib/tochka/config";

const path = "/account/integrations/";
function result(code: string): never { redirect(`${path}?result=${code}`); }

export async function savePaymentIntegration(form: FormData) {
  const user = await requirePermission("settings.write");
  if (!rateLimit(`integrations:${user.id}`, 10, 60_000).allowed) result("rate");
  const current = await getTochkaConfig();
  const token = String(form.get("token") ?? "").trim() || current.token;
  const parsed = tochkaConfigSchema.safeParse({ enabled: form.get("enabled") === "on", customerCode: String(form.get("customerCode") ?? "").trim(), merchantId: String(form.get("merchantId") ?? "").trim(), token, card: form.get("card") === "on", sbp: form.get("sbp") === "on", receiptMode: form.get("receiptMode"), vatType: String(form.get("vatType") ?? ""), taxSystemCode: String(form.get("taxSystemCode") ?? ""), externalReceiptsConfirmed: form.get("externalReceiptsConfirmed") === "on" });
  if (!parsed.success) result("invalid");
  const config = parsed.data;
  if (config.enabled && (!validProductionToken(token) || !config.customerCode || !config.merchantId || (!config.card && !config.sbp) || (config.receiptMode === "provider" ? !config.vatType || !config.taxSystemCode : !config.externalReceiptsConfirmed))) result("incomplete");
  const credentialsChanged = config.customerCode !== current.customerCode || config.merchantId !== current.merchantId || token !== current.token;
  const recipientChanged = config.customerCode !== current.customerCode || config.merchantId !== current.merchantId;
  const verificationChanged = credentialsChanged || config.card !== current.card || config.sbp !== current.sbp || config.receiptMode !== current.receiptMode;
  if (config.enabled || form.get("intent") === "check") {
    try { await checkTochka(config); } catch { result("connection"); }
    config.checkedAt = new Date().toISOString();
  } else config.checkedAt = verificationChanged ? undefined : current.checkedAt;
  // Serialize configuration changes with other saves. Never replace the merchant
  // while there are payments that still need reconciliation.
  const saved = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412026)`;
    if (JSON.stringify(await getTochkaConfig(tx)) !== JSON.stringify(current)) return false;
    if (recipientChanged && await tx.payment.count({ where: { provider: "tochka", status: { in: ["PENDING", "AUTHORIZED"] } } })) return false;
    // Optional checkedAt must be omitted rather than saved as an undefined JSON value.
    const { checkedAt, ...fields } = config;
    const value = { ...fields, token: token ? encryptSecret(token, TOCHKA_SETTING) : "", ...(checkedAt ? { checkedAt } : {}) };
    await tx.siteSetting.upsert({ where: { key: TOCHKA_SETTING }, create: { key: TOCHKA_SETTING, group: "integrations", value }, update: { value, group: "integrations" } });
    await tx.auditLog.create({ data: { actorId: user.id, action: "integration.payment.update", entityType: "SiteSetting", after: { provider: "tochka", enabled: config.enabled, customerCode: config.customerCode, merchantId: config.merchantId, credentialsChanged } } });
    return true;
  });
  if (!saved) result("pending");
  revalidatePath("/", "layout");
  result(config.checkedAt ? "verified" : "saved");
}

export async function saveDeliveryMethod(form: FormData) {
  const user = await requirePermission("settings.write");
  if (!rateLimit(`delivery-settings:${user.id}`, 30, 60_000).allowed) result("rate");
  const id = String(form.get("id") ?? "");
  const parsed = deliveryConfigSchema.safeParse({ name: form.get("name"), description: form.get("description"), basePrice: form.get("basePrice"), sortOrder: form.get("sortOrder"), active: form.get("active") === "on" });
  if (!parsed.success) result("invalid");
  const saved = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412028)`;
    if (id && !await tx.deliveryMethod.findFirst({ where: { id, deletedAt: null } })) return false;
    const method = id ? await tx.deliveryMethod.update({ where: { id }, data: parsed.data }) : await tx.deliveryMethod.create({ data: { ...parsed.data, code: `custom-${randomUUID()}` } });
    await tx.auditLog.create({ data: { actorId: user.id, action: "integration.delivery.update", entityType: "DeliveryMethod", entityId: method.id, after: parsed.data } });
    return true;
  });
  if (!saved) result("delivery-missing");
  revalidatePath("/", "layout");
  result("saved");
}

export async function deleteDeliveryMethod(form: FormData) {
  const user = await requirePermission("settings.write");
  if (!rateLimit(`delivery-settings:${user.id}`, 30, 60_000).allowed) result("rate");
  const id = String(form.get("id") ?? "");
  if (!id || id.length > 100 || form.get("confirmation") !== id) result("delivery-confirmation");
  const removed = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412028)`;
    const method = await tx.deliveryMethod.findFirst({ where: { id, deletedAt: null } });
    if (!method) return false;
    await tx.deliveryMethod.update({ where: { id }, data: { active: false, deletedAt: new Date() } });
    await tx.auditLog.create({ data: { actorId: user.id, action: "integration.delivery.delete", entityType: "DeliveryMethod", entityId: id, before: { code: method.code, name: method.name, description: method.description, basePrice: String(method.basePrice), sortOrder: method.sortOrder, active: method.active }, after: { active: false, deleted: true } } });
    return true;
  });
  if (!removed) result("delivery-missing");
  revalidatePath("/", "layout");
  result("delivery-deleted");
}
