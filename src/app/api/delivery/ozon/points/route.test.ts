import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ config: vi.fn(), find: vi.fn(), update: vi.fn(), info: vi.fn(), limit: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: m.find, ozonDeliveryPoint: { updateMany: m.update } } }));
vi.mock("@/lib/delivery/ozon-config", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/delivery/ozon-config")>(), getOzonDeliveryConfig: m.config }));
vi.mock("@/lib/delivery/ozon-client", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/delivery/ozon-client")>(), OzonDeliveryClient: class { pointInfo = m.info; } }));
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
    expect(await response.json()).toEqual({ points: [{ ...point, latitude: 44.99, longitude: 38.95 }], truncated: false, nextOffset: null, scope: expect.any(String) });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(m.find.mock.calls[0][0].values).toEqual(["test-client", 7n, "'яблоновский':*", "(^|[^[:alnum:]а-я])яблоновский", "(^|[^[:alnum:]а-я])яблоновский([^[:alnum:]а-я]|$)", "яблоновский", 201, 0]);
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
    expect(await (await GET(request())).json()).toEqual({ points: [point], truncated: false, nextOffset: null, scope: expect.any(String) });
    expect(m.update).not.toHaveBeenCalled();
  });
  it("ignores unsolicited IDs and hides inactive points", async () => {
    m.info.mockResolvedValue([{ delivery_point_id: 999, is_active: true, coordinates: { latitude: 50, longitude: 30 } }, { delivery_point_id: 42, is_active: false }]);
    expect(await (await GET(request())).json()).toEqual({ points: [], truncated: false, nextOffset: null, scope: expect.any(String) });
    expect(m.update).not.toHaveBeenCalled();
  });
  it("returns a bounded page and cursor, batching coordinate lookup to 100 public IDs", async () => {
    m.find.mockResolvedValue(Array.from({ length: 201 }, (_, i) => ({ ...point, id: String(i + 1) })));
    m.info.mockResolvedValue([]);
    const result = await (await GET(request())).json();
    expect(result.points).toHaveLength(200); expect(result.truncated).toBe(true); expect(result.nextOffset).toBe(200);
    expect(m.info).toHaveBeenCalledTimes(2);
    expect(m.info.mock.calls.every(([ids]) => ids.length === 100)).toBe(true);
  });
  it("binds the next page offset with deterministic address/id ordering", async () => {
    const laterPoint = { ...point, id: "201", address: "Санкт-Петербург, улица Савушкина, 124 корпус 1", latitude: 60, longitude: 30 };
    m.find.mockResolvedValue([laterPoint]);
    const response = await GET(new Request("https://sidzen.shop/api/delivery/ozon/points/?q=Санкт-Петербург&offset=200"));
    expect(await response.json()).toEqual({ points: [laterPoint], truncated: false, nextOffset: null, scope: expect.any(String) });
    const sql = m.find.mock.calls[0][0];
    expect(sql.values.slice(-2)).toEqual([201, 200]);
    expect(sql.text).toContain('"address" ASC, "id" ASC');
    expect(sql.text).toMatch(/OFFSET \$\d+/);
  });
  it("advances by the raw page size even when inactive points are removed", async () => {
    m.find.mockResolvedValue(Array.from({ length: 201 }, (_, i) => ({ ...point, id: String(i + 201) })));
    m.info.mockResolvedValue([{ delivery_point_id: 201, is_active: false }]);
    const result = await (await GET(new Request("https://sidzen.shop/api/delivery/ozon/points/?q=Омск&offset=200"))).json();
    expect(result.points).toHaveLength(199);
    expect(result.nextOffset).toBe(400);
    expect(result.truncated).toBe(true);
  });
  it.each(["-1", "1.5", "NaN", "1000001", "200%20OR%201=1"])("rejects invalid page offsets: %s", async offset => {
    expect((await GET(new Request(`https://sidzen.shop/api/delivery/ozon/points/?q=Омск&offset=${offset}`))).status).toBe(400);
    expect(m.find).not.toHaveBeenCalled();
  });
  it("refuses unavailable configuration and excessive requests", async () => {
    m.config.mockResolvedValue({ enabled: false });
    expect(await (await GET(request())).json()).toEqual({ points: [] }); expect(m.find).not.toHaveBeenCalled();
    m.limit.mockReturnValue({ allowed: false }); expect((await GET(request())).status).toBe(429);
  });
  it("does not turn a disabled integration into a successful final page", async () => {
    m.config.mockResolvedValue({ enabled: false });
    expect((await GET(new Request("https://sidzen.shop/api/delivery/ozon/points/?q=Омск&offset=200"))).status).toBe(409);
    expect(m.find).not.toHaveBeenCalled();
  });
  it("identifies the directory scope without exposing integration credentials", async () => {
    const first = await (await GET(request())).json();
    m.config.mockResolvedValue({ enabled: true, clientId: "other-client", shipmentMethodId: 8, checkedAt: "2030-01-01" });
    const second = await (await GET(request())).json();
    expect(first.scope).toMatch(/^[a-f0-9]{64}$/);
    expect(second.scope).not.toBe(first.scope);
    expect(JSON.stringify(first)).not.toContain("test-client");
    expect(JSON.stringify(first)).not.toContain("test-secret");
  });
  it("searches each word with bound parameters rather than demanding a contiguous phrase", async () => {
    await GET(new Request("https://sidzen.shop/api/delivery/ozon/points/?q=Омск,%20Бульварная%20_20%25"));
    const sql = m.find.mock.calls[0][0];
    expect(sql.values).toContain("(^|[^[:alnum:]а-я])омск");
    expect(sql.values).toContain("(^|[^[:alnum:]а-я])бульварная");
    expect(sql.values).toContain("(^|[^[:alnum:]а-я])20([^0-9]|$)");
    expect(sql.values.slice(0, 2)).toEqual(["test-client", 7n]);
    expect(sql.values.slice(-2)).toEqual([201, 0]);
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
    expect(m.find.mock.calls[0][0].values.slice(-2)).toEqual([9, 0]);
    expect(m.info).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled();
  });
  it("suggests distinct matching localities instead of pickup addresses", async () => {
    m.find.mockResolvedValue([
      { ...point, address: "Россия, Адыгея Республика, Тахтамукайский Район, Яблоновский, улица Андрухаева, 53" },
      { ...point, address: "Россия, Адыгея Республика, Яблоновский, улица Гагарина, 1" },
      { ...point, address: "Россия, Краснодарский край, город Яблоновка, улица Ленина, 3" },
      { ...point, address: "Россия, Омск, улица Яблоневая, 2" },
    ]);
    const response = await GET(new Request("https://sidzen.shop/api/delivery/ozon/points/?q=яблон&view=cities"));
    expect(await response.json()).toEqual({ cities: ["Яблоновский", "Яблоновка"] });
    expect(m.find.mock.calls[0][0].values.slice(-2)).toEqual([501, 0]);
    expect(m.info).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled();
  });
  it("ignores punctuation-only searches without accessing the database", async () => {
    expect(await (await GET(new Request("https://sidzen.shop/api/delivery/ozon/points/?q=%25__"))).json()).toEqual({ points: [] });
    expect(m.find).not.toHaveBeenCalled();
  });
});
