// Real database checks with synthetic orders. No production database or carrier calls.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { receivedOrdersWhere } from "../src/lib/dashboard-orders";
import { dashboardDelivery } from "../src/lib/dashboard-delivery";

const db = new URL(process.env.DATABASE_URL || "");
assert(["localhost", "127.0.0.1"].includes(db.hostname) && (db.pathname === "/shop_qa" || /^\/sidzen_dashboard_test_\d+$/.test(db.pathname)), "Only isolated local QA databases are allowed");
const prefix = `qa-dashboard-${randomUUID()}`;
const ids: string[] = [];
const ozon = (status: string, deliveryStatus: string, deliveredAt?: Date): Prisma.ShipmentCreateWithoutOrderInput => ({
  provider: "ozon-delivery", method: "QA", deliveredAt,
  ozonJob: { create: { clientId: "qa", request: { postings: [{ request_id: 1 }] }, status, response: { order_number: "QA", postings: [{ request_id: 1, posting_number: "QA-1" }], statuses: [{ posting_number: "QA-1", status: deliveryStatus, status_changed_at: "2030-01-01T12:00:00Z" }] } } },
});
const cdek = (status: string, deliveryStatus: string, deliveredAt?: Date): Prisma.ShipmentCreateWithoutOrderInput => ({
  provider: "cdek", method: "QA", deliveredAt,
  cdekJob: { create: { clientId: "qa", environment: "test", request: {}, status, deliveryStatus, deliveryStatusChangedAt: new Date("2030-01-01T12:00:00Z") } },
});
async function order(status: Prisma.EnumOrderStatusFieldUpdateOperationsInput["set"], shipment?: Prisma.ShipmentCreateWithoutOrderInput) {
  const created = await prisma.order.create({ data: { number: `${prefix}-${ids.length}`, status, customerName: "Synthetic buyer", customerEmail: "qa@example.test", customerPhone: "+70000000000", subtotal: 240, total: 240, ...(shipment ? { shipment: { create: shipment } } : {}) }, include: { shipment: { include: { ozonJob: true, cdekJob: true } } } });
  ids.push(created.id);
  return created;
}
try {
  const inTransit = await order("SHIPPED", ozon("CREATED", "on_way"));
  const conflictingOzon = await order("DELIVERED", ozon("CREATED", "on_way"));
  const confirmedManually = await order("DELIVERED");
  const confirmedOzon = await order("SHIPPED", ozon("FINISHED", "delivered", new Date("2030-01-01T12:00:00Z")));
  const newOrder = await order("NEW");
  const conflictingCdek = await order("DELIVERED", cdek("FINISHED", "NOT_DELIVERED"));
  const confirmedCdek = await order("SHIPPED", cdek("FINISHED", "DELIVERED", new Date("2030-01-01T12:00:00Z")));
  const previouslyConfirmed = await order("DELIVERED", ozon("FINISHED", "delivered"));
  const deliveredButStale = await order("DELIVERED", ozon("CREATED", "on_way", new Date("2029-01-01T12:00:00Z")));
  const deleted = await order("NEW");
  await prisma.order.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });

  const [current, archived] = await Promise.all([
    prisma.order.findMany({ where: { id: { in: ids }, deletedAt: null, NOT: receivedOrdersWhere }, select: { id: true } }),
    prisma.order.findMany({ where: { id: { in: ids }, deletedAt: null, ...receivedOrdersWhere }, select: { id: true } }),
  ]);
  assert.deepEqual(new Set(current.map(row => row.id)), new Set([inTransit.id, conflictingOzon.id, newOrder.id, conflictingCdek.id, deliveredButStale.id]));
  assert.deepEqual(new Set(archived.map(row => row.id)), new Set([confirmedManually.id, confirmedOzon.id, confirmedCdek.id, previouslyConfirmed.id]));
  assert.equal(dashboardDelivery(inTransit.shipment).label, "Ozon: В пути");
  assert.equal(dashboardDelivery(conflictingCdek.shipment).label, "СДЭК: Не вручено");
  console.log("PASS dashboard: in-transit and conflicting shipments remain visible, confirmed receipts are archived, deleted orders are excluded.");
} finally {
  await prisma.order.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
}
