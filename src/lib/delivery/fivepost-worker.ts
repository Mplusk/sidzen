import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { operatorReady } from "@/lib/privacy";
import { getFivePostConfig } from "./fivepost-config";
import { FivePostClient } from "./fivepost-client";
import { fivePostParcelSchema } from "./fivepost-quote";

const hour = 3600000;
type Money = { toString(): string };
type PaidOrder = { number: string; customerName: string; customerPhone: string; subtotal: Money; total: Money; deliveryPrice: Money; items: Array<{ productName: string; sku: string | null; quantity: number; unitPrice: Money }> };
export function fivePostOrderBody(order: PaidOrder, payload: unknown, senderLocation: string) {
  const { pointId, parcel } = z.object({ pointId: z.guid(), parcel: fivePostParcelSchema }).parse(payload);
  const price = Number(order.subtotal), currency = "RUB";
  return { partnerOrders: [{
    senderOrderId: order.number, clientOrderId: order.number, clientName: order.customerName, clientPhone: order.customerPhone,
    senderLocation, receiverLocation: pointId, undeliverableOption: "RETURN",
    cost: { price, priceCurrency: currency, deliveryCost: Number(order.deliveryPrice), deliveryCostCurrency: currency,
      paymentType: "PREPAYMENT", paymentValue: 0, paymentCurrency: currency, prepaymentSum: Number(order.total) },
    cargoes: [{ ...parcel, senderCargoId: `${order.number}-1`, price, currency,
      productValues: order.items.map(i => ({ name: i.productName, value: i.quantity, price: Number(i.unitPrice), currency, vat: -1, ...(i.sku ? { vendorCode: i.sku } : {}) })) }],
  }] };
}
export async function processFivePostJob() {
  const now = new Date(), unlocked = { OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] };
  const readyOrder = { deletedAt: null, personalDataErasedAt: null, stockReviewRequired: false, status: { notIn: ["CANCELED", "REFUNDED"] as ("CANCELED" | "REFUNDED")[] }, payment: { is: { status: "PAID" as const, refundReviewRequired: false } } };
  const job = await prisma.fivePostDeliveryJob.findFirst({
    where: { AND: [unlocked, { OR: [
      { status: "PENDING", shipment: { order: readyOrder } },
      { status: "PENDING", cancelRequestedAt: { not: null } },
      { status: { in: ["SENDING", "CREATED", "CANCELING"] } },
    ] }], nextAttemptAt: { lte: now } },
    include: { shipment: { include: { order: { include: { items: true } } } } }, orderBy: { nextAttemptAt: "asc" },
  });
  if (!job) return;
  const lockToken = randomUUID();
  if (!(await prisma.fivePostDeliveryJob.updateMany({ where: { id: job.id, status: job.status, ...unlocked }, data: { lockToken, lockedUntil: new Date(Date.now() + 90000) } })).count) return;
  const where = { id: job.id, lockToken };
  const release = { lockToken: null, lockedUntil: null };
  const save = (status: string, error: string | null = null, delay = hour) => prisma.fivePostDeliveryJob.updateMany({ where, data: { ...release, status, error, nextAttemptAt: new Date(Date.now() + delay) } });
  const order = job.shipment.order;
  const canceled = Boolean(job.cancelRequestedAt || order.deletedAt || ["CANCELED", "REFUNDED"].includes(order.status));
  let attemptedCreate = false;
  try {
    if (job.status === "PENDING" && canceled) { await save("CANCELED"); return; }
    const config = await getFivePostConfig();
    // Disabling the storefront stops new checkouts. Existing paid shipments keep their contract.
    if (!config.apiKey || !config.checkedAt || config.environment !== "production" || config.warehouseId !== job.warehouseId) { await save(job.status, "settings", 10 * 60000); return; }
    const api = new FivePostClient(config);
    if (job.status === "PENDING") {
      if (!await operatorReady()) { await save("PENDING", "settings", 600000); return; }
      const request = fivePostOrderBody(order, job.shipment.payload, job.senderLocation);
      const sending = await prisma.fivePostDeliveryJob.updateMany({ where: { ...where, cancelRequestedAt: null, shipment: { order: readyOrder } }, data: { status: "SENDING", attempts: { increment: 1 } } });
      if (!sending.count) { await save("PENDING", null, 0); return; }
      attemptedCreate = true;
      const remoteId = await api.create(request, order.number);
      await prisma.$transaction(async tx => {
        const saved = await tx.fivePostDeliveryJob.updateMany({ where, data: { ...release, remoteId, status: "CREATED", error: null, nextAttemptAt: new Date(Date.now() + 60000) } });
        if (saved.count) await tx.shipment.update({ where: { id: job.shipmentId }, data: { tracking: order.number } });
      });
      return;
    }
    if (job.remoteId && canceled && job.status !== "CANCELING") {
      await prisma.fivePostDeliveryJob.updateMany({ where, data: { status: "CANCELING" } });
      const result = await api.cancel(job.remoteId);
      await save(result.error ? result.canBeRetriedLater ? "CREATED" : "REVIEW" : "CANCELED", result.error ? "cancel" : null);
      return;
    }
    // Recover a lost create response by our immutable senderOrderId before considering another POST.
    const current = await api.status(order.number);
    if (!current || (job.remoteId && current.orderId !== job.remoteId)) { await save("REVIEW", "verify"); return; }
    const delivered = current.status === "DONE" && current.executionStatus === "PICKED_UP";
    const status = current.status === "CANCELLED" ? "CANCELED" : current.status === "DONE" ? "FINISHED" : "CREATED";
    await prisma.$transaction(async tx => {
      const saved = await tx.fivePostDeliveryJob.updateMany({ where, data: { ...release, remoteId: current.orderId, status, deliveryStatus: current.executionStatus, error: current.status === "REJECTED" ? "rejected" : null, nextAttemptAt: new Date(Date.now() + hour) } });
      if (saved.count) await tx.shipment.update({ where: { id: job.shipmentId }, data: { tracking: order.number, ...(delivered ? { deliveredAt: new Date(current.changeDate) } : {}) } });
    });
  } catch {
    // If DELETE was interrupted, reconcile its outcome before issuing another cancellation.
    const state = attemptedCreate ? "SENDING" : job.remoteId && canceled ? "CANCELING" : job.status;
    await save(state, "provider", hour);
  }
}
