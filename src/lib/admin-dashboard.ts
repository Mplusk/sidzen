import type { Prisma } from "@prisma/client";
import { fiscalAttentionWhere } from "@/lib/cloudkassir/attention";
import { archivedOrdersWhere, receivedOrdersWhere } from "@/lib/dashboard-orders";
import { prisma } from "@/lib/prisma";

export const dashboardPageSize = 25;

type OrderSummary = {
  ordersToday: number;
  revenue: Prisma.Decimal | null;
  average: Prisma.Decimal | null;
  newApplications: number;
  inProduction: number;
};

const orderFields = {
  id: true,
  number: true,
  kind: true,
  status: true,
  statusChangedAt: true,
  createdAt: true,
  purchaseConfirmedAt: true,
  customerName: true,
  shippingAddress: true,
  subtotal: true,
  total: true,
  shipment: {
    select: {
      provider: true,
      method: true,
      deliveredAt: true,
      cost: true,
      ozonJob: { select: { status: true, response: true, cancelRequestedAt: true } },
      cdekJob: { select: { status: true, deliveryStatus: true, deliveryStatusChangedAt: true, cancelRequestedAt: true } },
      fivePostJob: { select: { status: true, deliveryStatus: true, cancelRequestedAt: true } },
    },
  },
} satisfies Prisma.OrderSelect;

export async function loadAdminDashboard({ archived, page, canReadOrders }: { archived: boolean; page: number; canReadOrders: boolean }) {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const startOfDay = today.toISOString();
  const summaryQueries = [
    // Compiling the carrier filters costs much more than executing the dashboard queries.
    prisma.$executeRaw`SET LOCAL jit = off`,
    prisma.$queryRaw<OrderSummary[]>`
      SELECT
        COUNT(*) FILTER (WHERE o."deletedAt" IS NULL AND o."createdAt" >= ${startOfDay}::timestamp)::integer AS "ordersToday",
        SUM(o.total) FILTER (WHERE paid."orderId" IS NOT NULL AND o."createdAt" >= ${startOfDay}::timestamp) AS revenue,
        AVG(o.total) FILTER (WHERE paid."orderId" IS NOT NULL) AS average,
        COUNT(*) FILTER (WHERE o."deletedAt" IS NULL AND o.kind = 'APPLICATION' AND o.status = 'NEW')::integer AS "newApplications",
        COUNT(*) FILTER (WHERE o."deletedAt" IS NULL AND o.status IN ('IN_PROGRESS', 'QUEUED', 'PRINTING', 'POST_PROCESSING'))::integer AS "inProduction"
      FROM "Order" o
      LEFT JOIN "Payment" paid ON paid."orderId" = o.id AND paid.status = 'PAID'
        AND o.kind = 'ORDER' AND o.status NOT IN ('CANCELED', 'REFUNDED')
    `,
    prisma.product.count({ where: { status: "PUBLISHED", OR: [{ description: null }, { metaDescription: null }] } }),
    prisma.redirect.count({ where: { active: false } }),
    prisma.order.count({ where: fiscalAttentionWhere(now) }),
  ] as const;
  const where: Prisma.OrderWhereInput = { deletedAt: null, ...(archived ? archivedOrdersWhere : { NOT: archivedOrdersWhere }) };
  const orderQueries = [
    prisma.order.findMany({
      where, select: orderFields, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * dashboardPageSize, take: dashboardPageSize,
    }),
    prisma.order.count({ where }),
    prisma.order.count({ where: {
      deletedAt: null,
      status: { notIn: ["DELIVERED", "CANCELED", "REFUNDED"] },
      shipment: { is: { deliveredAt: { not: null } } },
      AND: [receivedOrdersWhere],
    } }),
    prisma.order.findFirst({
      where: { deletedAt: null, stockReviewRequired: true, status: "PAID" },
      select: { number: true }, orderBy: { updatedAt: "asc" },
    }),
  ] as const;

  // A single database connection serves each dashboard load, including its order list and counts.
  const options = { isolationLevel: "RepeatableRead" } as const;
  const [, [summary], thinContent, brokenRedirects, fiscalAttention, orders = [], total = 0, needsConfirmation = 0, lateStock = null] =
    canReadOrders ? await prisma.$transaction([...summaryQueries, ...orderQueries], options) : await prisma.$transaction([...summaryQueries], options);
  return { ...summary, thinContent, brokenRedirects, fiscalAttention, orders, total, needsConfirmation, lateStock };
}
