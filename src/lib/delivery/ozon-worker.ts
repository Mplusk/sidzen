import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { operatorReady } from "@/lib/privacy";
import { writeDiagnostic } from "@/lib/diagnostics";
import { getOzonDeliveryConfig } from "./ozon-config";
import { checkoutRequestSchema, OzonDeliveryClient, OzonDeliveryError, positiveId } from "./ozon-client";

const unlocked = () => ({ OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }] });
const asJson = (value: unknown) => value as Prisma.InputJsonValue;
const createdSchema = z.object({ order_number: z.string().min(1), postings: z.array(z.object({ request_id: positiveId, posting_number: z.string().min(1), estimated_delivery_days: z.number().int().nullish() })) });
const creationEnvelope = z.object({ order_number: z.string().min(1), postings: z.array(z.unknown()) });
const statusesSchema = z.object({ postings: z.array(z.object({ posting_number: z.string(), status: z.string(), status_changed_at: z.iso.datetime() })) });
export const paidOrderStatuses = ["PAID", "QUEUED", "PRINTING", "POST_PROCESSING", "PACKED", "SHIPPED", "DELIVERED"] as const;

export async function syncOzonPointsPage() {
  const sync = await prisma.ozonDeliverySync.findFirst({ where: { status: { in: ["PENDING", "RUNNING"] }, ...unlocked() } });
  if (!sync) return false;
  const lockToken = randomUUID();
  if (!(await prisma.ozonDeliverySync.updateMany({ where: { id: sync.id, generation: sync.generation, ...unlocked() }, data: { lockToken, lockedUntil: new Date(Date.now() + 120000), status: "RUNNING" } })).count) return false;
  try {
    const config = await getOzonDeliveryConfig();
    if (config.clientId !== sync.clientId || BigInt(config.shipmentMethodId ?? 0) !== sync.methodId || !config.enabled) throw new OzonDeliveryError("config");
    if (sync.pages >= 5000) throw new OzonDeliveryError("pagination");
    const api = new OzonDeliveryClient(config);
    const page = await api.pointPage(sync.cursor);
    if (page.next_cursor && page.next_cursor === sync.cursor) throw new OzonDeliveryError("pagination");
    const ids = page.delivery_points.filter(point => (Array.isArray(point.shipment_method_ids) ? point.shipment_method_ids : [point.shipment_method_ids]).includes(Number(sync.methodId))).map(point => point.delivery_point_id);
    const points = ids.length ? await api.pointInfo(ids) : [];
    await prisma.$transaction(async tx => {
      // A new settings save invalidates an old worker without publishing stale points.
      const claimed = await tx.ozonDeliverySync.updateMany({ where: { id: sync.id, generation: sync.generation, lockToken }, data: { cursor: page.next_cursor || null, pages: { increment: 1 }, points: { increment: points.length }, status: page.next_cursor ? "RUNNING" : "SUCCEEDED", error: null, lockToken: null, lockedUntil: null } });
      if (!claimed.count) return;
      for (const point of points) {
        const data = { name: point.name, address: point.full_address, type: point.type, active: point.is_active, clientId: sync.clientId, methodId: sync.methodId, generation: sync.generation, latitude: point.coordinates?.latitude ?? null, longitude: point.coordinates?.longitude ?? null };
        await tx.ozonDeliveryPoint.upsert({ where: { id: String(point.delivery_point_id) }, create: { id: String(point.delivery_point_id), ...data }, update: data });
      }
      if (!page.next_cursor) await tx.ozonDeliveryPoint.updateMany({ where: { generation: { not: sync.generation } }, data: { active: false } });
    }, { timeout: 20000 });
  } catch (error) {
    await writeDiagnostic("delivery.points.failed", { stage: "points", reason: error instanceof OzonDeliveryError ? error.code : "provider" });
    await prisma.ozonDeliverySync.updateMany({ where: { id: sync.id, lockToken }, data: { status: "FAILED", error: error instanceof OzonDeliveryError ? error.code : "provider", lockToken: null, lockedUntil: null } });
  }
  return true;
}

export async function processOzonJob(id?: string) {
  // Also covers pending jobs created before privacy safeguards were deployed.
  // Public pickup-directory reads and cancellation/status reconciliation remain available.
  if (!await operatorReady()) return false;
  const eligibleStatus = id ? { in: ["PENDING", "REVIEW"] } : "PENDING";
  const job = await prisma.ozonDeliveryJob.findFirst({ where: { cancelRequestedAt: null, shipment: { order: { deletedAt: null, OR: [{ kind: "APPLICATION", status: { notIn: ["CANCELED", "REFUNDED"] } }, { kind: "ORDER", ...(!id ? { OR: [{ payment: { status: "PAID" } }, { status: { in: [...paidOrderStatuses] } }] } : {}) }] } }, ...(id ? { id } : { nextAttemptAt: { lte: new Date() } }), status: eligibleStatus, ...unlocked() }, include: { shipment: { include: { order: { include: { payment: true } } } } }, orderBy: { nextAttemptAt: "asc" } });
  if (!job) return false;
  if (job.shipment.order.payment?.provider === "yookassa-online" && job.shipment.order.payment.status !== "PAID") return false;
  const lockToken = randomUUID();
  if (!(await prisma.ozonDeliveryJob.updateMany({ where: { id: job.id, cancelRequestedAt: null, shipment: { order: { deletedAt: null } }, status: eligibleStatus, ...unlocked() }, data: { lockToken, lockedUntil: new Date(Date.now() + 120000), attempts: { increment: 1 } } })).count) return false;
  try {
    if (["CANCELED", "REFUNDED"].includes(job.shipment.order.status)) {
      if (job.attempts > 0) throw new OzonDeliveryError("cancel-review");
      await prisma.ozonDeliveryJob.updateMany({ where: { id: job.id, lockToken }, data: { status: "CANCELED", lockToken: null, lockedUntil: null } }); return true;
    }
    if (job.shipment.order.kind !== "APPLICATION" && job.shipment.order.payment?.status !== "PAID" && !paidOrderStatuses.includes(job.shipment.order.status as typeof paidOrderStatuses[number]) && job.shipment.order.status !== "APPROVED") throw new OzonDeliveryError("unpaid");
    const config = await getOzonDeliveryConfig();
    if (config.clientId !== job.clientId || !config.clientSecret) throw new OzonDeliveryError("config");
    const api = new OzonDeliveryClient(config);
    const request = job.request;
    // Persisted body and UUID are immutable across retries, including ambiguous timeouts.
    const raw = creationEnvelope.parse(await api.json("/v1/order/create", request, { "Idempotency-Key": job.idempotencyKey }));
    const parsed = raw.postings.map(posting => createdSchema.shape.postings.element.safeParse(posting));
    const response = { order_number: raw.order_number, postings: parsed.flatMap(posting => posting.success ? [posting.data] : []) };
    const body = z.object({ postings: z.array(z.object({ request_id: positiveId })) }).parse(request);
    const complete = parsed.every(posting => posting.success) && response.postings.length === body.postings.length && new Set(response.postings.map(posting => posting.posting_number)).size === response.postings.length && body.postings.every(posting => response.postings.filter(row => row.request_id === posting.request_id).length === 1);
    if (!complete) {
      const previous = createdSchema.safeParse(job.response);
      if (previous.success) response.postings = [...new Map([...previous.data.postings, ...response.postings].map(posting => [posting.posting_number, posting])).values()];
    }
    await prisma.$transaction(async tx => {
      // Preserve accepted postings even when Ozon returns only part of the order.
      // Never automatically retry or consider an incomplete order fully canceled.
      if (!(await tx.ozonDeliveryJob.updateMany({ where: { id: job.id, lockToken }, data: { status: complete ? "CREATED" : "REVIEW", response: asJson(response), error: complete ? null : "partial", lockToken: null, lockedUntil: null } })).count) return;
      await tx.shipment.update({ where: { id: job.shipmentId }, data: { tracking: response.postings.map(posting => posting.posting_number).join(", ") } });
    });
  } catch (error) {
    await writeDiagnostic("delivery.shipment.failed", { stage: "shipment", reason: error instanceof OzonDeliveryError ? error.code : "provider", attempts: job.attempts + 1 });
    // Do not postpone a cancellation requested while this call was in flight.
    await prisma.ozonDeliveryJob.updateMany({ where: { id: job.id, lockToken, cancelRequestedAt: null }, data: { nextAttemptAt: new Date(Date.now() + Math.min(3600000, 60000 * 2 ** Math.min(job.attempts, 6))) } });
    await prisma.ozonDeliveryJob.updateMany({ where: { id: job.id, lockToken }, data: { error: error instanceof OzonDeliveryError ? error.code : "provider", lockToken: null, lockedUntil: null } });
  }
  return true;
}

export async function refreshOzonJob(id?: string) {
  const eligibleStatus = id ? { in: ["CREATED", "REVIEW"] } : "CREATED";
  const job = await prisma.ozonDeliveryJob.findFirst({ where: { cancelRequestedAt: null, ...(id ? { id } : { nextAttemptAt: { lte: new Date() } }), status: eligibleStatus, ...unlocked() } });
  if (!job) return false;
  const lockToken = randomUUID();
  if (!(await prisma.ozonDeliveryJob.updateMany({ where: { id: job.id, cancelRequestedAt: null, status: eligibleStatus, ...unlocked() }, data: { lockToken, lockedUntil: new Date(Date.now() + 120000) } })).count) return false;
  try {
    const config = await getOzonDeliveryConfig(); if (config.clientId !== job.clientId) throw new OzonDeliveryError("config");
    const created = createdSchema.parse(job.response);
    if (!created.postings.length) throw new OzonDeliveryError("partial");
    const api = new OzonDeliveryClient(config);
    const statuses = statusesSchema.parse(await api.json("/v1/posting/info", { posting_numbers: created.postings.map(value => value.posting_number) }));
    if (statuses.postings.length !== created.postings.length || created.postings.some(posting => statuses.postings.filter(row => row.posting_number === posting.posting_number).length !== 1)) throw new OzonDeliveryError("partial");
    const finished = statuses.postings.every(value => ["delivered", "canceled"].includes(value.status));
    await prisma.$transaction(async tx => {
      const saved = await tx.ozonDeliveryJob.updateMany({ where: { id: job.id, lockToken, cancelRequestedAt: null }, data: { response: asJson({ ...created, statuses: statuses.postings }), status: job.status === "REVIEW" ? "REVIEW" : finished ? statuses.postings.every(value => value.status === "canceled") ? "CANCELED" : "FINISHED" : "CREATED", error: job.status === "REVIEW" ? "partial" : null, nextAttemptAt: new Date(Date.now() + 300000), lockToken: null, lockedUntil: null } });
      // A partial creation or a canceled parcel cannot prove delivery of the order.
      if (saved.count && job.status !== "REVIEW" && statuses.postings.every(value => value.status === "delivered")) {
        const deliveredAt = new Date(Math.max(...statuses.postings.map(value => new Date(value.status_changed_at).getTime())));
        await tx.shipment.updateMany({ where: { id: job.shipmentId, deliveredAt: null }, data: { deliveredAt } });
      }
    });
  } catch (error) {
    await writeDiagnostic("delivery.status.failed", { stage: "status", reason: error instanceof OzonDeliveryError ? error.code : "provider" });
    await prisma.ozonDeliveryJob.updateMany({ where: { id: job.id, lockToken }, data: { error: error instanceof OzonDeliveryError ? error.code : "provider", nextAttemptAt: new Date(Date.now() + 600000), lockToken: null, lockedUntil: null } });
  }
  return true;
}

export function ozonCreateBody(request: unknown, number: string, name: string, names: string[]) {
  const quote = checkoutRequestSchema.parse(request);
  return { ...quote, order_external_id: number, recipient: { ...quote.recipient, full_name: name }, postings: quote.postings.map((posting, index) => ({ ...posting, posting_external_id: `${number}-${index + 1}`, description: names[index] || "Товар интернет-магазина" })) };
}

// Cancellation is a durable intent, not a "success" assumption. An in-flight
// creator keeps its lease and saves its response before this worker cancels it.
export async function cancelOzonJob(id?: string) {
  const job = await prisma.ozonDeliveryJob.findFirst({ where: { cancelRequestedAt: { not: null }, status: { not: "CANCELED" }, ...(id ? { id } : { nextAttemptAt: { lte: new Date() } }), ...unlocked() }, orderBy: { nextAttemptAt: "asc" } });
  if (!job) return false;
  const lockToken = randomUUID();
  if (!(await prisma.ozonDeliveryJob.updateMany({ where: { id: job.id, cancelRequestedAt: { not: null }, status: { not: "CANCELED" }, ...unlocked() }, data: { lockToken, lockedUntil: new Date(Date.now() + 120000) } })).count) return false;
  const save = (data: Prisma.OzonDeliveryJobUpdateManyMutationInput) => prisma.ozonDeliveryJob.updateMany({ where: { id: job.id, lockToken }, data });
  try {
    if (!job.attempts && job.status === "PENDING" && !job.response) {
      await save({ status: "CANCELED", cancelError: null, lockToken: null, lockedUntil: null });
      return true; // Proven never transmitted; do not create a remote order to cancel it.
    }
    const config = await getOzonDeliveryConfig();
    if (config.clientId !== job.clientId || !config.clientSecret) throw new OzonDeliveryError("config");
    const api = new OzonDeliveryClient(config);
    const expected = z.object({ postings: z.array(z.object({ request_id: positiveId })).min(1) }).parse(job.request);
    const complete = (value: z.infer<typeof createdSchema>) => value.postings.length === expected.postings.length && new Set(value.postings.map(posting => posting.posting_number)).size === value.postings.length && expected.postings.every(posting => value.postings.filter(row => row.request_id === posting.request_id).length === 1);
    let known = createdSchema.safeParse(job.response);
    if (!known.success || !complete(known.data)) {
      // A timed-out create may have succeeded remotely. Reconcile with the SAME
      // immutable request/key, never generate a new order identity.
      if (!await operatorReady()) throw new OzonDeliveryError("config");
      if (!(await save({ attempts: { increment: 1 }, lockedUntil: new Date(Date.now() + 120000) })).count) return false;
      const raw = creationEnvelope.parse(await api.json("/v1/order/create", job.request, { "Idempotency-Key": job.idempotencyKey }));
      const returned = raw.postings.flatMap(row => { const parsed = createdSchema.shape.postings.element.safeParse(row); return parsed.success ? [parsed.data] : []; });
      const previous = known.success ? known.data.postings : [];
      const response = { order_number: raw.order_number, postings: [...new Map([...previous, ...returned].map(row => [row.posting_number, row])).values()] };
      await save({ response: asJson(response) });
      known = createdSchema.safeParse(response);
      if (!known.success || !complete(known.data)) throw new OzonDeliveryError("partial");
    }
    if (!known.success) throw new OzonDeliveryError("partial");
    const created = known.data;
    const info = () => api.json("/v1/posting/info", { posting_numbers: created.postings.map(row => row.posting_number) }).then(value => statusesSchema.parse(value));
    const before = await info();
    if (before.postings.length !== created.postings.length || created.postings.some(row => before.postings.filter(status => status.posting_number === row.posting_number).length !== 1)) throw new OzonDeliveryError("partial");
    for (const posting of before.postings) {
      if (posting.status === "canceled") continue;
      if (posting.status === "delivered") throw new OzonDeliveryError("already-delivered");
      if (!(await save({ lockedUntil: new Date(Date.now() + 120000) })).count) return false;
      const response = await api.call("/v1/posting/cancel", { posting_number: posting.posting_number });
      await response.body?.cancel().catch(() => undefined);
    }
    const after = await info();
    const confirmed = after.postings.length === created.postings.length && created.postings.every(row => after.postings.filter(status => status.posting_number === row.posting_number && status.status === "canceled").length === 1);
    await save({ response: asJson({ ...created, statuses: after.postings }), status: confirmed ? "CANCELED" : job.status, cancelError: confirmed ? null : "cancel-pending", nextAttemptAt: new Date(Date.now() + 60000), lockToken: null, lockedUntil: null });
    await writeDiagnostic(confirmed ? "delivery.cancel.ok" : "delivery.cancel.pending", { stage: "cancel" });
  } catch (error) {
    const reason = error instanceof OzonDeliveryError ? error.code : "provider";
    await save({ cancelError: reason, nextAttemptAt: new Date(Date.now() + (reason === "already-delivered" ? 3600000 : 60000)), lockToken: null, lockedUntil: null });
    await writeDiagnostic("delivery.cancel.failed", { stage: "cancel", reason });
  }
  return true;
}
