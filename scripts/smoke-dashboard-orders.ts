// Real database checks with synthetic orders. No production database or carrier calls.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { loadAdminDashboard } from "../src/lib/admin-dashboard";
import { archivedOrdersWhere, receivedOrdersWhere } from "../src/lib/dashboard-orders";
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
type OrderDetails = Pick<Prisma.OrderCreateInput, "kind" | "createdAt" | "deletedAt" | "payment">;
async function order(status: Prisma.EnumOrderStatusFieldUpdateOperationsInput["set"], shipment?: Prisma.ShipmentCreateWithoutOrderInput, details: OrderDetails = {}) {
  const created = await prisma.order.create({ data: { number: `${prefix}-${ids.length}`, status, customerName: "Synthetic buyer", customerEmail: "qa@example.test", customerPhone: "+70000000000", subtotal: 240, total: 240, ...details, ...(shipment ? { shipment: { create: shipment } } : {}) }, include: { shipment: { include: { ozonJob: true, cdekJob: true } } } });
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
  const canceled = await order("CANCELED");
  const canceledInTransit = await order("CANCELED", ozon("CREATED", "on_way"));
  const canceledCdek = await order("CANCELED", cdek("CANCELED", "NOT_DELIVERED"));
  const refunded = await order("REFUNDED", ozon("FINISHED", "delivered", new Date("2030-01-01T12:00:00Z")));
  const deleted = await order("CANCELED");
  await prisma.order.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });

  const [current, archived, received] = await Promise.all([
    prisma.order.findMany({ where: { id: { in: ids }, deletedAt: null, NOT: archivedOrdersWhere }, select: { id: true } }),
    prisma.order.findMany({ where: { id: { in: ids }, deletedAt: null, ...archivedOrdersWhere }, select: { id: true } }),
    prisma.order.findMany({ where: { id: { in: ids }, deletedAt: null, ...receivedOrdersWhere }, select: { id: true } }),
  ]);
  assert.deepEqual(new Set(current.map(row => row.id)), new Set([inTransit.id, conflictingOzon.id, newOrder.id, conflictingCdek.id, deliveredButStale.id, refunded.id]));
  assert.deepEqual(new Set(archived.map(row => row.id)), new Set([confirmedManually.id, confirmedOzon.id, confirmedCdek.id, previouslyConfirmed.id, canceled.id, canceledInTransit.id, canceledCdek.id]));
  assert.deepEqual(new Set(received.map(row => row.id)), new Set([confirmedManually.id, confirmedOzon.id, confirmedCdek.id, previouslyConfirmed.id]));
  assert.equal(dashboardDelivery(inTransit.shipment).label, "Ozon: В пути");
  assert.equal(dashboardDelivery(conflictingCdek.shipment).label, "СДЭК: Не вручено");

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const payment = { create: { provider: "dashboard-fixture", status: "PAID" as const, amount: 240 } };
  const paidToday = await order("PAID", undefined, { createdAt: today, payment });
  await order("PAID", undefined, { createdAt: new Date(today.getTime() - 1), payment });
  await order("CANCELED", undefined, { payment });
  await order("REFUNDED", undefined, { payment });
  await order("PAID", undefined, { deletedAt: new Date(), payment });
  await order("NEW", undefined, { kind: "APPLICATION" });
  await order("PRINTING");

  const paidOrders = { kind: "ORDER", status: { notIn: ["CANCELED", "REFUNDED"] }, payment: { is: { status: "PAID" } } } satisfies Prisma.OrderWhereInput;
  const [ordersToday, revenue, average, applications, printing] = await prisma.$transaction([
    prisma.order.count({ where: { deletedAt: null, createdAt: { gte: today } } }),
    prisma.order.aggregate({ where: { ...paidOrders, createdAt: { gte: today } }, _sum: { total: true } }),
    prisma.order.aggregate({ where: paidOrders, _avg: { total: true } }),
    prisma.order.count({ where: { deletedAt: null, kind: "APPLICATION", status: "NEW" } }),
    prisma.order.count({ where: { deletedAt: null, status: { in: ["IN_PROGRESS", "QUEUED", "PRINTING", "POST_PROCESSING"] } } }),
  ]);
  const [active, archive, limited] = await Promise.all([
    loadAdminDashboard({ archived: false, page: 1, canReadOrders: true }),
    loadAdminDashboard({ archived: true, page: 1, canReadOrders: true }),
    loadAdminDashboard({ archived: false, page: 1, canReadOrders: false }),
  ]);
  assert.equal(active.ordersToday, ordersToday);
  assert.equal(Number(active.revenue), Number(revenue._sum.total));
  assert.equal(Number(active.average), Number(average._avg.total));
  assert.equal(active.newApplications, applications);
  assert.equal(active.inProduction, printing);
  assert(active.orders.some(row => row.id === paidToday.id));
  assert(archive.orders.some(row => row.id === canceled.id));
  assert.deepEqual(limited.orders, []);
  assert.equal(limited.total, 0);
  assert.equal(limited.ordersToday, active.ordersToday);
  console.log("PASS dashboard: active and archived orders, financial totals, aggregate counts and order permissions with concurrent loads.");
} finally {
  await prisma.order.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
}
