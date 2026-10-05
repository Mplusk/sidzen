"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { operatorReady } from "@/lib/privacy";
import { encryptSecret } from "@/lib/integration-secrets";
import { CLOUD_SETTING, cloudReady, cloudSchema, getCloudConfig, validInn } from "@/lib/cloudkassir/config";
import { checkCloud } from "@/lib/cloudkassir/client";
import { refreshTochkaPayment } from "@/lib/payments";
import { recoverFiscalReceipt } from "@/lib/cloudkassir/recovery";

function result(code: string): never { redirect(`/account/integrations/?result=cloud-${code}#cloudkassir`); }
export async function saveCloudIntegration(form: FormData) {
  const user = await requirePermission("settings.write");
  if (!rateLimit(`cloud-config:${user.id}`, 10, 60_000).allowed) result("rate");
  const current = await getCloudConfig();
  const publicId = String(form.get("publicId") ?? "").trim();
  const secret = form.get("clearSecret") === "on" ? "" : String(form.get("apiSecret") ?? "").trim() || (publicId === current.publicId ? current.apiSecret : "");
  const parsed = cloudSchema.safeParse({ publicId, apiSecret: secret, inn: String(form.get("inn") ?? "").trim(), deviceNumber: String(form.get("deviceNumber") ?? "").trim(), fiscalNumber: String(form.get("fiscalNumber") ?? "").trim(), enabled: form.get("enabled") === "on", productionConfirmed: form.get("productionConfirmed") === "on", operatorReviewed: form.get("operatorReviewed") === "on", taxConfirmed: form.get("taxConfirmed") === "on" });
  if (!parsed.success) result("invalid");
  const config = parsed.data;
  const changed = JSON.stringify({ ...current, checkedAt: undefined, enabled: undefined }) !== JSON.stringify({ ...config, checkedAt: undefined, enabled: undefined });
  config.checkedAt = changed ? undefined : current.checkedAt;
  if (config.enabled || form.get("intent") === "check") {
    const legalInn = await prisma.siteSetting.findUnique({ where: { key: "legal.inn" } });
    if (!await operatorReady() || !validInn(config.inn) || String(legalInn?.value ?? "") !== config.inn || !config.publicId || !config.apiSecret || !config.deviceNumber || config.fiscalNumber.length !== 16 || !config.productionConfirmed || !config.taxConfirmed || !config.operatorReviewed) result("incomplete");
    try { await checkCloud(config); } catch { result("connection"); }
    config.checkedAt = new Date().toISOString();
  }
  const saved = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412026)`;
    if (JSON.stringify(await getCloudConfig(tx)) !== JSON.stringify(current)) return false;
    const identityChanged = config.publicId !== current.publicId || config.inn !== current.inn || !config.apiSecret;
    if (identityChanged && (await tx.fiscalReceipt.count({ where: { status: { notIn: ["PROCESSED", "CANCELED"] } } }) || await tx.payment.count({ where: { provider: "tochka", status: { in: ["PENDING", "AUTHORIZED", "PAID"] }, order: { fiscalReceipts: { some: {} } } } }))) return false;
    const { checkedAt, ...fields } = config;
    const value = { ...fields, apiSecret: secret ? encryptSecret(secret, CLOUD_SETTING) : "", ...(checkedAt ? { checkedAt } : {}) };
    await tx.siteSetting.upsert({ where: { key: CLOUD_SETTING }, create: { key: CLOUD_SETTING, group: "integrations", value }, update: { value, group: "integrations" } });
    await tx.auditLog.create({ data: { actorId: user.id, action: "integration.cloudkassir.update", entityType: "SiteSetting", after: { enabled: config.enabled, credentialsChanged: changed, checked: Boolean(config.checkedAt), taxRegime: "ausn_income", vat: "none" } } });
    return true;
  });
  if (!saved) result("pending");
  revalidatePath("/", "layout"); result(cloudReady(config) || config.checkedAt ? "verified" : "saved");
}
export async function checkFiscalOrder(form: FormData) {
  const user = await requirePermission("orders.write");
  const id = String(form.get("orderId") ?? "");
  const order = await prisma.order.findUnique({ where: { id }, include: { payment: true } });
  if (!order) redirect("/admin/orders/");
  if (rateLimit(`fiscal-order:${user.id}:${id}`, 5, 60_000).allowed && order.payment?.provider === "tochka") {
    await refreshTochkaPayment(order.payment.id).catch(() => undefined);
    await prisma.fiscalReceipt.updateMany({ where: { orderId: id, status: { in: ["PENDING", "SENDING", "QUEUED"] } }, data: { nextAttemptAt: new Date() } });
  }
  revalidatePath(`/admin/orders/${order.number}/`);
  redirect(`/admin/orders/${encodeURIComponent(order.number)}/?fiscal=checked`);
}

export async function reconcileFiscalReceipt(form: FormData) {
  const user = await requirePermission("orders.write");
  const id = String(form.get("receiptId") ?? "");
  const row = await prisma.fiscalReceipt.findUnique({ where: { id }, include: { order: { select: { number: true } } } });
  if (!row) redirect("/admin/orders/");
  let success = false;
  if (form.get("confirmation") === id && rateLimit(`fiscal-recover:${user.id}`, 5, 60_000).allowed) {
    try { await recoverFiscalReceipt(id, String(form.get("externalId") ?? "").trim(), user.id); success = true; } catch { /* Do not disclose provider payloads or customer email. */ }
  }
  revalidatePath(`/admin/orders/${row.order.number}/`);
  redirect(`/admin/orders/${encodeURIComponent(row.order.number)}/?fiscal=${success ? "reconciled" : "error"}`);
}
