import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ config: vi.fn(), find: vi.fn(), update: vi.fn(), info: vi.fn(), limit: vi.fn(), sync: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { $queryRaw: m.find, ozonDeliveryPoint: { updateMany: m.update }, ozonDeliverySync: { findUnique: m.sync } } }));
vi.mock("@/lib/delivery/ozon-config", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/delivery/ozon-config")>(), getOzonDeliveryConfig: m.config }));
vi.mock("@/lib/delivery/ozon-client", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/delivery/ozon-client")>(), OzonDeliveryClient: class { pointInfo = m.info; } }));
vi.mock("@/lib/rate-limit", () => ({ rateLimit: m.limit }));
import { GET } from "./route";
import { pointMapCache } from "@/lib/delivery/point-map-cache";

const point = { id: "42", name: "ПВЗ", address: "Яблоновский, улица 1", type: "pvz", latitude: null, longitude: null };
const request = () => new Request("https://sidzen.shop/api/delivery/ozon/points/?q=Яблоновский");
describe("public Ozon PVZ map directory", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    pointMapCache.clear();
    m.sync.mockResolvedValue({ generation: "directory-one", status: "SUCCEEDED" });
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
  it("returns a full large map batch from PostgreSQL without provider calls or coordinate writes", async () => {
    const directory = Array.from({ length: 3931 }, (_, index) => ({ ...point, id: String(index) }));
    m.find.mockResolvedValue(directory);
    const response = await GET(new Request("https://sidzen.shop/api/delivery/ozon/points/?q=Санкт-Петербург&view=map"));
    const data = await response.json();
    expect(data.points).toEqual(directory); expect(data.truncated).toBe(false); expect(data.nextOffset).toBeNull();
    expect(data.scope).toMatch(/^[a-f0-9]{64}$/);
    expect(m.find.mock.calls[0][0].values.slice(-2)).toEqual([5001, 0]);
    expect(m.info).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-cache");
    expect(response.headers.get("etag")).toMatch(/^"[a-f0-9]{64}"$/);
  });
  it("continues beyond 5000 map results without a new city cap", async () => {
    const directory = Array.from({ length: 5001 }, (_, index) => ({ ...point, id: String(index) }));
    m.find.mockResolvedValueOnce(directory).mockResolvedValueOnce([directory[5000]]);
    const first = await (await GET(new Request("https://sidzen.shop/api/delivery/ozon/points/?q=Омск&view=map"))).json();
    const last = await (await GET(new Request(`https://sidzen.shop/api/delivery/ozon/points/?q=Омск&view=map&offset=${first.nextOffset}`))).json();
    expect(first.points).toHaveLength(5000); expect(first.truncated).toBe(true); expect(first.nextOffset).toBe(5000);
    expect(last.points).toEqual([directory[5000]]); expect(last.truncated).toBe(false); expect(last.nextOffset).toBeNull();
    expect(last.scope).toBe(first.scope);
    expect(m.find.mock.calls[1][0].values.slice(-2)).toEqual([5001, 5000]);
  });
  it("reuses a map response and honours conditional requests while checking configuration", async () => {
    const url = "https://sidzen.shop/api/delivery/ozon/points/?q=Омск&view=map";
    const first = await GET(new Request(url));
    const etag = first.headers.get("etag")!;
    const cached = await GET(new Request(url));
    expect(await cached.text()).toBe(await first.text());
    const conditional = await GET(new Request(url, { headers: { "If-None-Match": `"other", W/${etag}` } }));
    expect(conditional.status).toBe(304); expect(await conditional.text()).toBe("");
    expect(m.find).toHaveBeenCalledOnce(); expect(m.config).toHaveBeenCalledTimes(3); expect(m.sync).toHaveBeenCalledTimes(3);
    m.config.mockResolvedValue({ enabled: false });
    const disabled = await GET(new Request(url, { headers: { "If-None-Match": etag } }));
    expect(disabled.status).toBe(200); expect(await disabled.json()).toEqual({ points: [] });
    expect(disabled.headers.get("cache-control")).toBe("private, no-store");
    expect(m.find).toHaveBeenCalledOnce();
  });
  it("invalidates maps when sync generation, completion or delivery configuration changes", async () => {
    const url = "https://sidzen.shop/api/delivery/ozon/points/?q=Омск&view=map";
    const first = await (await GET(new Request(url))).json();
    m.sync.mockResolvedValue({ generation: "directory-two", status: "RUNNING" });
    const running = await (await GET(new Request(url))).json();
    m.sync.mockResolvedValue({ generation: "directory-two", status: "SUCCEEDED" });
    const finished = await (await GET(new Request(url))).json();
    m.config.mockResolvedValue({ enabled: true, clientId: "another-client", shipmentMethodId: 8, checkedAt: "2030-01-01" });
    const changed = await (await GET(new Request(url))).json();
    expect(new Set([first.scope, running.scope, finished.scope, changed.scope]).size).toBe(4);
    expect(m.find).toHaveBeenCalledTimes(4);
  });
  it("does not cache a failed map query or return it as an empty city", async () => {
    const url = "https://sidzen.shop/api/delivery/ozon/points/?q=Омск&view=map";
    m.find.mockRejectedValueOnce(new Error("database")).mockResolvedValueOnce([point]);
    const failure = await GET(new Request(url));
    expect(failure.status).toBe(503); expect(failure.headers.get("cache-control")).toBe("private, no-store");
    const recovered = await GET(new Request(url));
    expect(recovered.status).toBe(200); expect((await recovered.json()).points).toEqual([point]);
    expect(m.find).toHaveBeenCalledTimes(2);
  });
  it.each(["q=Я", "q=%25__", "q=Омск&offset=-1"])("does not cache invalid/empty map requests: %s", async query => {
    const response = await GET(new Request(`https://sidzen.shop/api/delivery/ozon/points/?view=map&${query}`));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("etag")).toBeNull(); expect(m.find).not.toHaveBeenCalled();
  });
});
