import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ config: vi.fn(), find: vi.fn(), update: vi.fn(), info: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { ozonDeliveryPoint: { findMany: m.find, updateMany: m.update } } }));
vi.mock("@/lib/delivery/ozon-config", () => ({ getOzonDeliveryConfig: m.config }));
vi.mock("@/lib/delivery/ozon-client", () => ({ OzonDeliveryClient: class { pointInfo = m.info; } }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: m.limit }));
import { GET } from "./route";

const point = { id: "42", name: "ПВЗ", address: "Яблоновский, улица 1", type: "pvz", latitude: null, longitude: null };
const request = () => new Request("https://3dprinta.shop/api/delivery/ozon/points/?q=Яблоновский");
describe("public Ozon PVZ map directory", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    m.config.mockResolvedValue({ enabled: true, clientId: "test-client", clientSecret: "test-secret", shipmentMethodId: 7, checkedAt: "2030-01-01" });
    m.limit.mockReturnValue({ allowed: true }); m.find.mockResolvedValue([{ ...point }]);
    m.info.mockResolvedValue([{ delivery_point_id: 42, is_active: true, coordinates: { latitude: 44.99, longitude: 38.95 } }]);
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
