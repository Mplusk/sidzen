import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ config: vi.fn(), find: vi.fn(), update: vi.fn(), info: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: m.find, ozonDeliveryPoint: { updateMany: m.update } } }));
vi.mock("@/lib/delivery/ozon-config", () => ({ getOzonDeliveryConfig: m.config }));
vi.mock("@/lib/delivery/ozon-client", () => ({ OzonDeliveryClient: class { pointInfo = m.info; } }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: m.limit }));
import { GET } from "./route";

const point = { id: "42", name: "ПВЗ", address: "Яблоновский, улица 1", type: "pvz", latitude: null, longitude: null };
const request = () => new Request("https://sidzen.shop/api/delivery/ozon/points/?q=Яблоновский");
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
    expect(m.find.mock.calls[0][0].values).toEqual(["test-client", 7n, "'яблоновский':*", "(^|[^[:alnum:]а-я])яблоновский", "(^|[^[:alnum:]а-я])яблоновский([^[:alnum:]а-я]|$)", "яблоновский", 201]);
    expect(m.find.mock.calls[0][0].text).toContain('"active" = true');
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
  it("searches each word with bound parameters rather than demanding a contiguous phrase", async () => {
    await GET(new Request("https://sidzen.shop/api/delivery/ozon/points/?q=Омск,%20Бульварная%20_20%25"));
    const sql = m.find.mock.calls[0][0];
    expect(sql.values).toContain("(^|[^[:alnum:]а-я])омск");
    expect(sql.values).toContain("(^|[^[:alnum:]а-я])бульварная");
    expect(sql.values).toContain("(^|[^[:alnum:]а-я])20([^0-9]|$)");
    expect(sql.values.slice(0, 2)).toEqual(["test-client", 7n]);
    expect(sql.values.at(-1)).toBe(201);
    expect(sql.text).not.toContain("бульварная"); expect(sql.text).toContain("translate(lower");
    expect(sql.text).toContain("to_tsvector('simple'::regconfig");
    expect(sql.text).toContain("@@ to_tsquery('simple'::regconfig");
    expect(sql.values).toContain("'омск':* & 'бульварная':* & '20':*");
  });
  it("limits live suggestions to eight and never contacts the provider while typing", async () => {
    m.find.mockResolvedValue(Array.from({ length: 9 }, (_, index) => ({ ...point, id: String(index) })));
    const response = await GET(new Request("https://sidzen.shop/api/delivery/ozon/points/?q=Яблоновский&view=suggest"));
    const result = await response.json();
    expect(result.points).toHaveLength(8); expect(result.truncated).toBe(true);
    expect(m.find.mock.calls[0][0].values.at(-1)).toBe(9);
    expect(m.info).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled();
  });
  it("ignores punctuation-only searches without accessing the database", async () => {
    expect(await (await GET(new Request("https://sidzen.shop/api/delivery/ozon/points/?q=%25__"))).json()).toEqual({ points: [] });
    expect(m.find).not.toHaveBeenCalled();
  });
});
