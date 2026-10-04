import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ config: vi.fn(), find: vi.fn(), update: vi.fn(), info: vi.fn(), limit: vi.fn(), count: vi.fn(), query: vi.fn(), ready: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { ozonDeliveryPoint: { findMany: m.find, updateMany: m.update, count: m.count }, $queryRaw: m.query } }));
vi.mock("@/lib/delivery/ozon-config", () => ({ getOzonDeliveryConfig: m.config }));
vi.mock("@/lib/delivery/ozon-client", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/delivery/ozon-client")>(), OzonDeliveryClient: class { pointInfo = m.info; } }));
vi.mock("@/lib/privacy", () => ({ operatorReady: m.ready }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: m.limit }));
import { GET, POST } from "./route";

const point = { id: "42", name: "ПВЗ", address: "Яблоновский, улица 1", type: "pvz", latitude: null, longitude: null };
const request = () => new Request("https://3dprinta.shop/api/delivery/ozon/points/?q=Яблоновский");
describe("public Ozon PVZ map directory", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.config.mockResolvedValue({ enabled: true, clientId: "test-client", clientSecret: "test-secret", shipmentMethodId: 7, checkedAt: "2030-01-01" });
    m.limit.mockReturnValue({ allowed: true }); m.find.mockResolvedValue([{ ...point }]);
    m.ready.mockResolvedValue(true); m.count.mockResolvedValue(0); m.query.mockResolvedValue([{ ...point, latitude: 44.99, longitude: 38.95, distanceKm: 1.234 }]);
    m.info.mockResolvedValue([{ delivery_point_id: 42, is_active: true, coordinates: { latitude: 44.99, longitude: 38.95 } }]);
  });
  const near = (body: unknown = { latitude: 44.990127, longitude: 38.951795 }, origin = "https://3dprinta.shop") => new Request("https://3dprinta.shop/api/delivery/ozon/points/", { method: "POST", headers: { origin, host: "3dprinta.shop", "content-type": "application/json" }, body: JSON.stringify(body) });
  it("finds nearby public points locally without sending device coordinates to Ozon or writing them", async () => {
    const response = await POST(near());
    expect(await response.json()).toMatchObject({ points: [{ distanceKm: 1.2 }], nearby: true, truncated: false });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(m.query.mock.calls[0].slice(1)).toEqual([44.99, 44.99, 38.952, "test-client", 7n]);
    expect(m.query.mock.calls[0][0].join("")).toContain('ORDER BY "distanceKm", id LIMIT 61');
    expect(m.info).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled();
  });
  it("rejects foreign origins, nonnumeric, extra and out-of-range coordinates", async () => {
    expect((await POST(near(undefined, "https://foreign.invalid"))).status).toBe(403);
    for (const body of [{ latitude: 91, longitude: 1 }, { latitude: "44.99", longitude: 1 }, { latitude: 44, longitude: 30, phone: "+79991234567" }, { latitude: null, longitude: 1 }]) expect((await POST(near(body))).status).toBe(400);
    expect(m.query).not.toHaveBeenCalled();
  });
  it("does not mislabel sparse old coordinate caches as a nearest-point result", async () => {
    m.count.mockResolvedValue(90000);
    expect((await POST(near())).status).toBe(503); expect(m.query).not.toHaveBeenCalled();
  });
  it("caps nearest results and fails safely on disabled config, rate limits, storage or database errors", async () => {
    m.query.mockResolvedValue(Array.from({ length: 61 }, (_, i) => ({ ...point, id: String(i), distanceKm: i / 10 })));
    const result = await (await POST(near())).json(); expect(result.points).toHaveLength(60); expect(result.truncated).toBe(true);
    m.query.mockRejectedValue(new Error("private-database-details")); const failed = await POST(near()); expect(failed.status).toBe(503); expect(await failed.text()).not.toContain("private-database-details");
    m.ready.mockResolvedValue(false); expect((await POST(near())).status).toBe(503);
    m.ready.mockResolvedValue(true); m.config.mockResolvedValue({ enabled: false }); expect((await POST(near())).status).toBe(503);
    m.limit.mockReturnValue({ allowed: false }); expect((await POST(near())).status).toBe(429);
  });
  it("fills only scoped, active public coordinates without recipient information", async () => {
    const response = await GET(request());
    expect(await response.json()).toEqual({ points: [{ ...point, latitude: 44.99, longitude: 38.95 }], truncated: false });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(m.find.mock.calls[0][0]).toMatchObject({ where: { clientId: "test-client", methodId: 7n, active: true }, take: 201 });
    expect(m.info).toHaveBeenCalledWith([42]);
    expect(m.update).toHaveBeenCalledWith({ where: { id: "42", clientId: "test-client", methodId: 7n, active: true }, data: { latitude: 44.99, longitude: 38.95 } });
  });
  it("does not contact Ozon when cached coordinates are available", async () => {
    m.find.mockResolvedValue([{ ...point, latitude: 44.99, longitude: 38.95 }]);
    await GET(request()); expect(m.info).not.toHaveBeenCalled();
  });
  it("keeps address selection working when coordinate lookup fails", async () => {
    m.info.mockRejectedValue(new Error("temporary"));
    expect(await (await GET(request())).json()).toEqual({ points: [point], truncated: false });
    expect(m.update).not.toHaveBeenCalled();
  });
  it("ignores unsolicited IDs and hides inactive points", async () => {
    m.info.mockResolvedValue([{ delivery_point_id: 999, is_active: true, coordinates: { latitude: 50, longitude: 30 } }, { delivery_point_id: 42, is_active: false }]);
    expect(await (await GET(request())).json()).toEqual({ points: [], truncated: false });
    expect(m.update).not.toHaveBeenCalled();
  });
  it("caps results and batches coordinate lookup to 100 public IDs", async () => {
    m.find.mockResolvedValue(Array.from({ length: 201 }, (_, i) => ({ ...point, id: String(i + 1) })));
    m.info.mockResolvedValue([]);
    const result = await (await GET(request())).json();
    expect(result.points).toHaveLength(200); expect(result.truncated).toBe(true);
    expect(m.info).toHaveBeenCalledTimes(2);
    expect(m.info.mock.calls.every(([ids]) => ids.length === 100)).toBe(true);
  });
  it("refuses unavailable configuration and excessive requests", async () => {
    m.config.mockResolvedValue({ enabled: false });
    expect(await (await GET(request())).json()).toEqual({ points: [] }); expect(m.find).not.toHaveBeenCalled();
    m.limit.mockReturnValue({ allowed: false }); expect((await GET(request())).status).toBe(429);
  });
});
