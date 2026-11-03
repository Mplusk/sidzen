import { createHash, randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./prisma";
import { privacySubject, rfStorageReady } from "./privacy";
import { encryptSecret } from "./integration-secrets";
import { clientErasureTarget } from "./clients";
import { erasureBlocked, orderRetentionEnd, hasFinancialEvidence, inactiveAccountCutoff, RETENTION } from "./privacy-retention-policy";

const LOCK = 73412042;
const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
export const erasurePlanSchema = z.object({
  id: z.uuid(), userId: id.nullable(), orderIds: z.array(id), retainedIds: z.array(id),
  reviewFiles: z.array(z.string().regex(/^[a-f0-9-]{36}\.webp$/)),
  modelFiles: z.array(z.string().regex(/^[A-Za-z0-9_-]+\.(?:stl|obj|3mf|step|stp)$/i)),
  modelIds: z.array(id), subjectHash: z.string().length(64), at: z.iso.datetime(),
  reason: z.enum(["administrator", "retention"]), retainedUntil: z.iso.datetime().nullable(),
  consentReceipts: z.array(z.object({ purpose: z.string().max(100), version: z.string().max(100), subjectHash: z.string().length(64), at: z.iso.datetime(), text: z.string().max(8000) })).default([]),
});
export type ErasurePlan = z.infer<typeof erasurePlanSchema>;
export const ledgerDirectory = () => process.env.PRIVACY_ERASURE_LEDGER_DIR || join(process.cwd(), "privacy-ledger");
const ledgerFile = (value: string) => join(ledgerDirectory(), `${z.uuid().parse(value)}.json.enc`);
export class ErasureError extends Error {
  constructor(readonly code: "active" | "protected" | "missing" | "storage" | "files-in-use") { super(code); }
}
const orderInclude = { payment: true, fiscalReceipts: true, yookassaSettlement: true, shipment: { include: { ozonJob: true, cdekJob: true } } } as const;
async function lock(tx: Prisma.TransactionClient) {
  // Match the order/review worker's lock order before the privacy lock.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412026)`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412032)`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(73412034)`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK})`;
}
async function assertCustomer(tx: Prisma.TransactionClient, userId: string | null, actorId?: string) {
  if (!userId) return;
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  const user = await tx.user.findUnique({ where: { id: userId }, include: { roles: { include: { role: true } } } });
  if (user && (actorId === user.id || user.roles.some(row => row.role.code !== "customer"))) throw new ErasureError("protected");
}
async function writeLedger(plan: ErasurePlan) {
  await mkdir(ledgerDirectory(), { recursive: true, mode: 0o700 });
  // Independent persistent volume: never roll this back with a database backup.
  await writeFile(ledgerFile(plan.id), encryptSecret(JSON.stringify(plan), `privacy-erasure:${plan.id}`), { flag: "wx", mode: 0o600 });
}
async function applyPlan(tx: Prisma.TransactionClient, plan: ErasurePlan, actorId?: string, evaluationNow = new Date()) {
  const now = new Date(plan.at), ids = plan.orderIds;
  await assertCustomer(tx, plan.userId, actorId);
  const orders = await tx.order.findMany({ where: { id: { in: ids } }, include: orderInclude });
  if (orders.some(order => erasureBlocked(order, evaluationNow))) throw new ErasureError("active");
  if (orders.some(order => hasFinancialEvidence(order) && orderRetentionEnd(order) > evaluationNow && (!plan.retainedIds.includes(order.id) || !plan.retainedUntil || orderRetentionEnd(order) > new Date(plan.retainedUntil)))) throw new ErasureError("active");
  // A restored plan may never erase someone else's newly-owned file.
  if (await tx.orderItem.count({ where: { modelFileId: { in: plan.modelIds }, orderId: { notIn: ids } } })) throw new ErasureError("files-in-use");
  const guestKeys = ids.length ? await tx.$queryRaw<Array<{ key: string }>>(Prisma.sql`
    WITH contacts AS (
      SELECT "id", lower(trim("customerEmail")) AS email_key,
        regexp_replace("customerPhone", '[^0-9]', '', 'g') AS digits
      FROM "Order" WHERE "id" IN (${Prisma.join(ids)})
    ), normalized AS (
      SELECT *, CASE WHEN length(digits) = 11 AND left(digits, 1) = '8' THEN '7' || substr(digits, 2) ELSE digits END AS phone_key FROM contacts
    ) SELECT 'order:' || encode(sha256(convert_to(CASE WHEN email_key <> '' AND phone_key <> '' THEN json_build_array(email_key, phone_key)::text ELSE "id" END, 'UTF8')), 'hex') AS key FROM normalized
  `) : [];
  const clientKeys = [...guestKeys.map(row => row.key), ...(plan.userId ? [`account:${plan.userId}`] : [])];
  await tx.clientArchive.deleteMany({ where: { key: { in: clientKeys } } });
  await tx.auditLog.deleteMany({ where: { entityType: "Client", entityId: { in: clientKeys.map(key => createHash("sha256").update(key).digest("hex")) } } });
  if (plan.userId) {
    // Revoke/delete reviews and queues before deleting their consents/account.
    await tx.review.deleteMany({ where: { userId: plan.userId } });
    await tx.privacyConsent.deleteMany({ where: { userId: plan.userId } });
    await tx.cart.deleteMany({ where: { userId: plan.userId } });
    await tx.auditLog.updateMany({ where: { actorId: plan.userId }, data: { actorId: null, before: Prisma.DbNull, after: Prisma.DbNull, ip: null } });
  }
  await tx.privacyConsent.deleteMany({ where: { orderId: { in: ids } } });
  await tx.orderNotification.deleteMany({ where: { orderId: { in: ids } } });
  await tx.telegramOrderJob.deleteMany({ where: { orderId: { in: ids } } });
  await tx.shipment.deleteMany({ where: { orderId: { in: ids } } });
  await tx.orderItem.updateMany({ where: { orderId: { in: ids } }, data: { configuration: Prisma.DbNull } });
  await tx.orderItem.updateMany({ where: { orderId: { in: ids }, OR: [{ productId: null }, { modelFileId: { not: null } }] }, data: { productName: "Индивидуальное изделие", sku: null } });
  for (const order of orders) {
    // Fiscal/contact evidence is restricted to the historical order, never kept
    // in the customer directory or a still-usable account/session.
    const retain = plan.retainedIds.includes(order.id) && orderRetentionEnd(order) > evaluationNow;
    await tx.order.update({ where: { id: order.id }, data: {
      userId: null, customerPhone: "", shippingAddress: null, customerComment: null, internalNote: null,
      personalDataErasedAt: now, company: retain ? order.company : null,
      customerName: retain ? order.customerName : "Данные удалены", customerEmail: retain ? order.customerEmail : "",
    } });
    await tx.payment.updateMany({ where: { orderId: order.id }, data: { payload: Prisma.DbNull } });
    if (!retain) {
      await tx.fiscalReceipt.deleteMany({ where: { orderId: order.id } });
      await tx.yooKassaSettlement.deleteMany({ where: { orderId: order.id } });
      // Without an independent retention basis do not keep a re-identifiable
      // order-number stub merely for convenience or statistics.
      await tx.order.delete({ where: { id: order.id } });
      await tx.auditLog.deleteMany({ where: { entityType: { in: ["Order", "Shipment"] }, entityId: { in: [order.id, ...(order.shipment ? [order.shipment.id] : [])] } } });
      continue;
    }
    await tx.auditLog.updateMany({ where: { entityType: { in: ["Order", "Shipment"] }, entityId: { in: [order.id, ...(order.shipment ? [order.shipment.id] : [])] } }, data: { before: Prisma.DbNull, after: Prisma.DbNull, ip: null } });
  }
  await tx.customerModelFile.deleteMany({ where: { id: { in: plan.modelIds } } });
  if (plan.userId) await tx.user.deleteMany({ where: { id: plan.userId } });
  await tx.privacyErasure.upsert({ where: { id: plan.id }, create: {
    id: plan.id, subjectHash: plan.subjectHash, reason: plan.reason, plan, createdAt: now,
    retainedUntil: plan.retainedUntil ? new Date(plan.retainedUntil) : null,
  }, update: { plan, filesRemovedAt: null } });
  await tx.auditLog.create({ data: { actorId: actorId ?? null, action: "privacy.erase", entityType: "PrivacyErasure", entityId: plan.id, after: { orders: plan.orderIds.length, retained: plan.retainedIds.length, reason: plan.reason } } });
}
export async function eraseClientData(key: string, actorId: string, now = new Date()) {
  if (!rfStorageReady()) throw new ErasureError("storage");
  const result = await prisma.$transaction(async tx => {
    await lock(tx);
    const target = await clientErasureTarget(tx, key);
    if (!target) throw new ErasureError("missing");
    return buildAndApply(tx, target.userId, target.guestOrderIds, "administrator", now, actorId);
  }, { isolationLevel: "Serializable", timeout: 20000 });
  await removeErasureFiles(result).catch(() => {}); // durable queue retries physical deletion
  return result;
}
async function buildAndApply(tx: Prisma.TransactionClient, userId: string | null, extraIds: string[], reason: "administrator" | "retention", now: Date, actorId?: string) {
  await assertCustomer(tx, userId, actorId);
  const orders = await tx.order.findMany({ where: { OR: [{ id: { in: extraIds } }, ...(userId ? [{ userId }] : [])] }, include: orderInclude });
  if (orders.some(order => erasureBlocked(order, now))) throw new ErasureError("active");
  const orderIds = orders.map(order => order.id);
  const models = await tx.customerModelFile.findMany({ where: { OR: [...(userId ? [{ ownerId: userId }] : []), { orderItems: { some: { orderId: { in: orderIds } } } }] }, select: { id: true, storedName: true } });
  if (await tx.orderItem.count({ where: { modelFileId: { in: models.map(model => model.id) }, orderId: { notIn: orderIds } } })) throw new ErasureError("files-in-use");
  const images = userId ? await tx.reviewImage.findMany({ where: { review: { userId } }, select: { fileName: true } }) : [];
  const consents = await tx.privacyConsent.findMany({ where: { OR: [...(userId ? [{ userId }] : []), { orderId: { in: orderIds } }] }, select: { purpose: true, version: true, subjectHash: true, createdAt: true, document: true } });
  const retained = orders.filter(order => hasFinancialEvidence(order) && orderRetentionEnd(order) > now);
  const plan = erasurePlanSchema.parse({ id: randomUUID(), userId, orderIds, retainedIds: retained.map(order => order.id),
    reviewFiles: images.map(image => image.fileName), modelFiles: models.map(model => model.storedName), modelIds: models.map(model => model.id),
    subjectHash: privacySubject("erasure", userId ?? orderIds.join(":")), at: now.toISOString(), reason,
    consentReceipts: consents.map(receipt => ({ purpose: receipt.purpose, version: receipt.version, subjectHash: privacySubject("consent-evidence", receipt.subjectHash), at: receipt.createdAt.toISOString(), text: receipt.document && typeof receipt.document === "object" && !Array.isArray(receipt.document) && typeof receipt.document.text === "string" ? receipt.document.text : "" })),
    retainedUntil: retained.length ? new Date(Math.max(...retained.map(order => orderRetentionEnd(order).getTime()))).toISOString() : null,
  });
  await writeLedger(plan); // fail closed: no erasure without independent restore evidence
  await applyPlan(tx, plan, actorId, now);
  return plan;
}
export async function eraseExpiredOrders(orderIds: string[], now: Date) {
  if (!rfStorageReady()) return;
  await prisma.$transaction(async tx => {
    await lock(tx);
    const orders = await tx.order.findMany({ where: { id: { in: orderIds } }, include: orderInclude });
    const expired = orders.filter(order => !erasureBlocked(order, now) && orderRetentionEnd(order) <= now);
    if (expired.length) await buildAndApply(tx, null, expired.map(order => order.id), "retention", now);
  }, { isolationLevel: "Serializable", timeout: 20000 });
}
export async function eraseInactiveAccount(userId: string, now: Date) {
  if (!rfStorageReady()) return;
  await prisma.$transaction(async tx => {
    await lock(tx); await assertCustomer(tx, userId);
    const user = await tx.user.findUnique({ where: { id: userId } });
    const cutoff = inactiveAccountCutoff(now);
    if (!user || user.lastActiveAt >= cutoff || user.updatedAt >= cutoff || await tx.session.count({ where: { userId, expiresAt: { gt: now } } })) throw new ErasureError("active");
    await buildAndApply(tx, userId, [], "retention", now);
  }, { isolationLevel: "Serializable", timeout: 20000 });
}
export async function removeErasureFiles(plan: ErasurePlan) {
  for (const name of plan.reviewFiles) {
    await unlink(join(process.cwd(), "private-uploads", "reviews", name)).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
  for (const name of plan.modelFiles) {
    await unlink(join(process.cwd(), "private-uploads", name)).catch(error => { if (error.code !== "ENOENT") throw error; });
  }
  await prisma.privacyErasure.updateMany({ where: { id: plan.id }, data: { filesRemovedAt: new Date() } });
}
export async function drainErasureFiles() {
  const rows = await prisma.privacyErasure.findMany({ where: { filesRemovedAt: null }, take: 25 });
  for (const row of rows) await removeErasureFiles(erasurePlanSchema.parse(row.plan));
}
/** OFFLINE restoration only: replay protected tombstones before reopening the app. */
export async function applyRestoredErasurePlan(plan: ErasurePlan) {
  await prisma.$transaction(async tx => { await lock(tx); await applyPlan(tx, plan); }, { isolationLevel: "Serializable", timeout: 20000 });
  await removeErasureFiles(plan);
}
export async function pruneErasureEvidence(now: Date) {
  const cutoff = new Date(now); cutoff.setUTCFullYear(cutoff.getUTCFullYear() - RETENTION.erasureEvidenceYears);
  const rows = await prisma.privacyErasure.findMany({ where: { filesRemovedAt: { lt: cutoff } }, take: 100 });
  for (const row of rows) {
    await unlink(ledgerFile(row.id)).catch(error => { if (error.code !== "ENOENT") throw error; });
    await prisma.privacyErasure.delete({ where: { id: row.id } });
  }
}
