import { renderToReadableStream } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), productCount: vi.fn(), redirectCount: vi.fn(),
  queryRaw: vi.fn(), transaction: vi.fn((queries: Promise<unknown>[]) => Promise.all(queries)),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {
  $queryRaw: m.queryRaw,
  $transaction: m.transaction,
  order: { findMany: m.findMany, findFirst: m.findFirst, count: m.count },
  product: { count: m.productCount },
  redirect: { count: m.redirectCount },
} }));
vi.mock("@/lib/auth", () => ({ requirePermission: vi.fn().mockResolvedValue({ roles: ["superadmin"], permissions: new Set() }) }));
vi.mock("@/lib/cloudkassir/attention", () => ({ fiscalAttentionWhere: () => ({}) }));
import AdminDashboard from "./page";

const changedAt = new Date("2030-01-01T12:00:00.000Z");
const order = {
  id: "qa", number: "QA-1", kind: "ORDER", customerName: "Тест", createdAt: changedAt,
  status: "CANCELED", statusChangedAt: changedAt, purchaseConfirmedAt: null, shippingAddress: null, subtotal: 240, total: 240,
  shipment: { provider: "ozon-delivery", method: "QA", cost: null, deliveredAt: changedAt,
    ozonJob: { status: "CREATED", response: null, cancelRequestedAt: changedAt }, cdekJob: null },
};

beforeEach(() => {
  vi.clearAllMocks();
  m.count.mockResolvedValue(0);
  m.queryRaw.mockResolvedValue([{ ordersToday: 0, revenue: 0, average: 0, newApplications: 0, inProduction: 0 }]);
  m.productCount.mockResolvedValue(0); m.redirectCount.mockResolvedValue(0);
  m.findFirst.mockResolvedValue(null);
});

async function renderDashboard(view?: string) {
  const errors: unknown[] = [];
  const page = await AdminDashboard({ searchParams: Promise.resolve({ view }) });
  const stream = await renderToReadableStream(page, { onError: error => { errors.push(error); } });
  await stream.allReady;
  const html = await new Response(stream).text();
  expect(errors).toEqual([]);
  return html;
}

describe("dashboard archive", () => {
  it("surfaces a paid order needing stock review even if it is not on the current page", async () => {
    m.findMany.mockResolvedValue([]); m.findFirst.mockResolvedValue({ number: "QA-LATE" });
    const html = await renderDashboard();
    expect(html).toContain("Оплата поступила после окончания резерва");
    expect(html).toContain('/admin/orders/QA-LATE');
    expect(m.transaction).toHaveBeenCalledOnce();
  });
  it("labels a canceled order as canceled and warns if carrier cancellation is unconfirmed", async () => {
    m.findMany.mockResolvedValue([order]);
    const html = await renderDashboard("received");
    expect(html).toContain("Полученные и отменённые заказы");
    expect(html).toContain("Дата отмены заказа");
    expect(html).toContain("Проверьте отмену доставки");
    expect(html).not.toContain("Требует подтверждения");
    expect(html).not.toContain("По данным службы доставки");
  });

  it("keeps delivery confirmation visible for received orders awaiting acknowledgement", async () => {
    m.findMany.mockResolvedValue([{ ...order, status: "SHIPPED", shipment: { ...order.shipment, ozonJob: null } }]);
    const html = await renderDashboard("received");
    expect(html).toContain("По данным службы доставки");
    expect(html).toContain("Требует подтверждения");
    expect(html).not.toContain("Дата отмены заказа");
  });
});
