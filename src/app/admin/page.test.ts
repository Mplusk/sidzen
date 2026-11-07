import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  findMany: vi.fn(), count: vi.fn(), aggregate: vi.fn(), productCount: vi.fn(), redirectCount: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { order: { findMany: m.findMany, count: m.count, aggregate: m.aggregate }, product: { count: m.productCount }, redirect: { count: m.redirectCount } } }));
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
  m.count.mockResolvedValue(0); m.aggregate.mockResolvedValue({ _sum: { total: 0 }, _avg: { total: 0 } });
  m.productCount.mockResolvedValue(0); m.redirectCount.mockResolvedValue(0);
});

describe("dashboard archive", () => {
  it("labels a canceled order as canceled and warns if carrier cancellation is unconfirmed", async () => {
    m.findMany.mockResolvedValue([order]);
    const html = renderToStaticMarkup(await AdminDashboard({ searchParams: Promise.resolve({ view: "received" }) }));
    expect(html).toContain("Полученные и отменённые заказы");
    expect(html).toContain("Дата отмены заказа");
    expect(html).toContain("Проверьте отмену доставки");
    expect(html).not.toContain("Требует подтверждения");
    expect(html).not.toContain("По данным службы доставки");
  });

  it("keeps delivery confirmation visible for received orders awaiting acknowledgement", async () => {
    m.findMany.mockResolvedValue([{ ...order, status: "SHIPPED", shipment: { ...order.shipment, ozonJob: null } }]);
    const html = renderToStaticMarkup(await AdminDashboard({ searchParams: Promise.resolve({ view: "received" }) }));
    expect(html).toContain("По данным службы доставки");
    expect(html).toContain("Требует подтверждения");
    expect(html).not.toContain("Дата отмены заказа");
  });
});
