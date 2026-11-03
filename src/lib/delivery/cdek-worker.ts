import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { operatorReady } from "@/lib/privacy";
import { CdekDeliveryClient, CdekDeliveryError } from "./cdek-client";
import { getCdekConfig } from "./cdek-config";

const unlocked = () => ({ OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }] });
const requestSchema = z.object({ type: z.string(), state: z.string(), request_uuid: z.string().optional() });
const orderSchema = z.object({ entity: z.object({ uuid: z.uuid().optional(), cdek_number: z.union([z.string(), z.number()]).optional(), statuses: z.array(z.object({ code: z.string() })).optional() }).optional(), requests: z.array(requestSchema).optional() });
const acceptedSchema = z.object({ entity: z.object({ uuid: z.uuid() }), requests: z.array(requestSchema).optional() });

/** CDEK accepts writes asynchronously. Never retry an uncertain create: type 2
 * orders have no reliable client order number with which to reconcile them. */
export async function processCdekJob() {
  const now = new Date();
  const job = await prisma.cdekDeliveryJob.findFirst({ where: { status: { in: ["PENDING", "SENDING", "ACCEPTED", "CREATED", "CANCELING"] }, nextAttemptAt: { lte: now }, ...unlocked() }, include: { shipment: { include: { order: { include: { payment: true } } } } }, orderBy: { nextAttemptAt: "asc" } });
  if (!job) return false;
  const lockToken = randomUUID();
  if (!(await prisma.cdekDeliveryJob.updateMany({ where: { id: job.id, status: job.status, ...unlocked() }, data: { lockToken, lockedUntil: new Date(Date.now() + 60000) } })).count) return false;
  const save = (data: Parameters<typeof prisma.cdekDeliveryJob.updateMany>[0]["data"]) => prisma.cdekDeliveryJob.updateMany({ where: { id: job.id, lockToken }, data: { ...data, lockToken: null, lockedUntil: null } });
  const later = () => new Date(Date.now() + 30000);
  try {
    if (job.status === "SENDING") { await save({ status: "REVIEW", error: "create-uncertain" }); return true; }
    if (job.status === "PENDING" && (job.cancelRequestedAt || job.shipment.order.deletedAt || ["CANCELED", "REFUNDED"].includes(job.shipment.order.status))) {
      await save({ status: "CANCELED", error: null }); return true;
    }
    if (job.status === "PENDING" && !await operatorReady()) { await save({ nextAttemptAt: later() }); return true; }
    if (job.status === "PENDING" && job.shipment.order.kind !== "APPLICATION" && job.shipment.order.payment?.status !== "PAID") { await save({ nextAttemptAt: later() }); return true; }
    const config = await getCdekConfig();
    if (config.clientId !== job.clientId || config.environment !== job.environment || !config.clientSecret) throw new Error("config");
    const api = new CdekDeliveryClient(config, config.environment);
    if (job.status === "PENDING") {
      // Mark before transmission. If the process stops at any point, require
      // manual reconciliation rather than creating a duplicate order.
      const sending = await prisma.cdekDeliveryJob.updateMany({ where: { id: job.id, lockToken, cancelRequestedAt: null, shipment: { order: { deletedAt: null, status: { notIn: ["CANCELED", "REFUNDED"] } } } }, data: { status: "SENDING", attempts: { increment: 1 } } });
      if (!sending.count) { await save({ nextAttemptAt: later() }); return true; }
      const result = acceptedSchema.parse(await api.createOrder(job.request));
      await save({ status: "ACCEPTED", remoteId: result.entity.uuid, nextAttemptAt: new Date(Date.now() + 5000), error: null });
      return true;
    }
    if (!job.remoteId) throw new Error("missing-id");
    const current = orderSchema.parse(await api.order(job.remoteId));
    const create = current.requests?.find(value => value.type === "CREATE");
    const cancellation = current.requests?.find(value => value.type === "DELETE");
    if (current.entity?.cdek_number) await prisma.shipment.updateMany({ where: { id: job.shipmentId }, data: { tracking: String(current.entity.cdek_number) } });
    if (cancellation?.state === "SUCCESSFUL") { await save({ status: "CANCELED", error: null }); return true; }
    if (cancellation?.state === "INVALID") { await save({ status: "REVIEW", error: "cancel-rejected" }); return true; }
    if (job.status === "CANCELING" && !cancellation && job.cancelRequestedAt && Date.now() - job.cancelRequestedAt.getTime() > 180000) { await save({ status: "REVIEW", error: "cancel-uncertain" }); return true; }
    if (job.status === "CANCELING" || cancellation) { await save({ status: "CANCELING", nextAttemptAt: later(), error: null }); return true; }
    if (create?.state === "INVALID") { await save({ status: "REVIEW", error: "create-rejected" }); return true; }
    if (create?.state !== "SUCCESSFUL") { await save({ status: "ACCEPTED", nextAttemptAt: later() }); return true; }
    if (job.cancelRequestedAt || job.shipment.order.deletedAt || ["CANCELED", "REFUNDED"].includes(job.shipment.order.status)) {
      // Persist intent before DELETE; reconcile an uncertain reply by polling.
      await prisma.cdekDeliveryJob.updateMany({ where: { id: job.id, lockToken }, data: { status: "CANCELING" } });
      await api.deleteOrder(job.remoteId);
      await save({ status: "CANCELING", nextAttemptAt: later(), error: null });
      return true;
    }
    const statuses = current.entity?.statuses?.map(value => value.code) ?? [];
    const finished = statuses.some(value => ["DELIVERED", "NOT_DELIVERED"].includes(value));
    await save({ status: finished ? "FINISHED" : "CREATED", nextAttemptAt: new Date(Date.now() + 3600000), error: null });
    if (!finished) await prisma.cdekDeliveryJob.updateMany({ where: { id: job.id, status: "CREATED", cancelRequestedAt: { not: null } }, data: { nextAttemptAt: new Date() } });
  } catch (error) {
    if (job.status === "CANCELING" && error instanceof CdekDeliveryError && error.code === "not-found") { await save({ status: "CANCELED", error: null }); return true; }
    if (job.status === "PENDING") await save({ status: "REVIEW", error: "create-uncertain" });
    else await save({ error: "provider", nextAttemptAt: later() });
  }
  return true;
}
