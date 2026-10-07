import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const m = vi.hoisted(() => ({ permission: vi.fn(), count: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requirePermission: m.permission }));
vi.mock("@/lib/prisma", () => ({ prisma: { diagnosticLog: { count: m.count, findMany: m.list } } }));
vi.mock("@/components/clear-diagnostic-logs", () => ({ ClearDiagnosticLogs: () => null }));
import LogsPage from "./page";
beforeEach(() => { vi.resetAllMocks(); m.permission.mockResolvedValue({}); m.count.mockResolvedValue(1); m.list.mockResolvedValue([]); });
describe("private actionable delivery diagnostics", () => {
  it("checks administrator permissions before reading logs", async () => {
    m.permission.mockRejectedValue(new Error("forbidden"));
    await expect(LogsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("forbidden");
    expect(m.count).not.toHaveBeenCalled(); expect(m.list).not.toHaveBeenCalled();
  });
  it("shows a closed Russian failure label and public point ID, not raw response text", async () => {
    m.list.mockResolvedValue([{ id: "fixture", reference: "00000000-0000-4000-8000-000000000001", area: "delivery", level: "WARN", code: "delivery.unavailable", createdAt: new Date("2030-01-01Z"), details: {checkoutFailure: "point-restrictions", pointId: 42, expectedParcels: 1, receivedParcels: 1, message: "SECRET phone +79991234567", token: "SECRET"} }]);
    const html = renderToStaticMarkup(await LogsPage({searchParams: Promise.resolve({})}));
    expect(html).toContain("Ozon сообщил об ограничениях выбранного ПВЗ для посылки");
    expect(html).toContain("pointId"); expect(html).toContain("42"); expect(html).not.toMatch(/SECRET|79991234567/);
  });
});
