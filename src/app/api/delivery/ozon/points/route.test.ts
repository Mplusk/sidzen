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
  it("provides a compact shared city directory and rebuilds it after a sync", async () => {
    m.sync.mockResolvedValue({ generation: "city-directory-first", status: "SUCCEEDED" });
    m.find.mockResolvedValueOnce([
      { address: "Россия, Москва, улица Тверская, 1" },
      { address: "Россия, Москва, улица Ленина, 2" },
      { address: "Россия, Омск, улица Ленина, 1" },
    ]).mockResolvedValueOnce([{ address: "Россия, Тамбов, улица Ленина, 1" }]);
    const url = "https://sidzen.shop/api/delivery/ozon/points/?view=directory";
    const first = await GET(new Request(url));
    expect(await first.json()).toEqual({ cities: ["Москва", "Омск"] });
    expect(first.headers.get("cache-control")).toBe("private, max-age=300");
    expect(await (await GET(new Request(url))).json()).toEqual({ cities: ["Москва", "Омск"] });
    expect(m.find).toHaveBeenCalledTimes(1);
    expect(m.find.mock.calls[0][0].join(" ")).toContain('SELECT DISTINCT "address"');
    expect(m.info).not.toHaveBeenCalled();
    m.sync.mockResolvedValue({ generation: "city-directory-second", status: "SUCCEEDED" });
    expect(await (await GET(new Request(url))).json()).toEqual({ cities: ["Тамбов"] });
    expect(m.find).toHaveBeenCalledTimes(2);
  });
  it("does not cache a disabled or failed city directory", async () => {
    const url = "https://sidzen.shop/api/delivery/ozon/points/?view=directory";
    m.config.mockResolvedValueOnce({ enabled: false });
    const disabled = await GET(new Request(url));
    expect(disabled.status).toBe(409); expect(disabled.headers.get("cache-control")).toBe("private, no-store");
    m.sync.mockResolvedValue({ generation: "city-directory-failure", status: "SUCCEEDED" });
    m.find.mockRejectedValueOnce(new Error("db")).mockResolvedValueOnce([{ address: "Россия, Омск, улица Ленина, 1" }]);
    const failed = await GET(new Request(url));
    expect(failed.status).toBe(503); expect(failed.headers.get("cache-control")).toBe("private, no-store");
    expect(await (await GET(new Request(url))).json()).toEqual({ cities: ["Омск"] });
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
  it("suggests a city with a transposed letter without contacting the provider", async () => {
    m.sync.mockResolvedValue({ generation: "typo-dictionary", status: "SUCCEEDED" });
    m.find.mockResolvedValueOnce([]).mockResolvedValueOnce([{ address: "Россия, Тамбов, улица Ленина, 1" }]);
    const response = await GET(new Request("https://sidzen.shop/api/delivery/ozon/points/?q=Табмов&view=cities"));
    expect(await response.json()).toEqual({ cities: ["Тамбов"] });
    expect(m.find).toHaveBeenCalledTimes(2);
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
  it("opens a city from compact metadata without returning or enriching all pickup addresses", async () => {
    m.find.mockResolvedValue(Array.from({ length: 10000 }, (_, index) => ({ latitude: 55.55 + (index % 100) * 0.004, longitude: 37.3 + Math.floor(index / 100) * 0.006 })));
    const response = await GET(new Request("https://sidzen.shop/api/delivery/ozon/points/?q=Москва&view=city"));
    const data = await response.json();
    expect(data.city.name).toBe("Москва");
    expect(data.city.bounds.north - data.city.bounds.south).toBeGreaterThan(0.3);
    expect(data.points).toBeUndefined(); expect(JSON.stringify(data).length).toBeLessThan(400);
    expect(m.info).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled();
    expect(m.find.mock.calls[0][0].text).toContain('SELECT "latitude", "longitude"');
  });
  it("keeps an unknown or mistyped city unresolved for the suggestion flow", async () => {
    m.find.mockResolvedValue([]);
    const response = await GET(new Request("https://sidzen.shop/api/delivery/ozon/points/?q=Табмов&view=city"));
    expect(await response.json()).toEqual({ city: null, scope: expect.any(String) });
    expect(m.info).not.toHaveBeenCalled();
  });
  it("loads only bounded viewport features with no city or provider request", async () => {
    const preview = { ...point, id: "nearest", address: "Москва, улица Ближайшая, 1", latitude: 55.7, longitude: 37.6 };
    m.find.mockResolvedValueOnce([
      { id: "p", count: 1, name: "ПВЗ", address: "Москва, улица 1", type: "pvz", latitude: 55.7, longitude: 37.5, south: 55.7, west: 37.5, north: 55.7, east: 37.5 },
      { id: "c", count: 2000, name: null, address: null, type: null, latitude: 55.8, longitude: 37.6, south: 55.75, west: 37.55, north: 55.85, east: 37.65 },
    ]).mockResolvedValueOnce([preview]);
    const response = await GET(new Request("https://sidzen.shop/api/delivery/ozon/points/?view=viewport&bbox=37.3,55.5,37.9,55.9&zoom=11"));
    const data = await response.json();
    expect(data.points).toHaveLength(1); expect(data.clusters).toHaveLength(1);
    expect(data.listPoints).toEqual([preview]); expect(data.points[0].id).toBe("p");
    expect(data.clusters[0].count).toBe(2000); expect(data.scope).toMatch(/^[a-f0-9]{64}$/);
    expect(m.find.mock.calls[0][0].values).toEqual(expect.arrayContaining(["test-client", 7n, 37.3, 55.5, 37.9, 55.9]));
    expect(m.find.mock.calls[0][0].text).toContain("GROUP BY cell");
    expect(m.find).toHaveBeenCalledTimes(2);
    expect(m.find.mock.calls[1][0].values.at(-1)).toBe(20);
    expect(m.find.mock.calls[1][0].text).toContain('"latitude" BETWEEN');
    expect(m.info).not.toHaveBeenCalled(); expect(m.update).not.toHaveBeenCalled();
    expect(JSON.stringify(data)).not.toContain("test-secret");
    expect(data.listPoints[0].workTime).toBeUndefined();
  });
  it("caches clustered addresses with their markers and retries a failed preview query", async () => {
    const cluster = { id: "c", count: 2000, name: null, address: null, type: null, latitude: 55.8, longitude: 37.6, south: 55.75, west: 37.55, north: 55.85, east: 37.65 };
    const preview = { ...point, latitude: 55.8, longitude: 37.6 };
    m.find.mockResolvedValueOnce([cluster]).mockRejectedValueOnce(new Error("database"))
      .mockResolvedValueOnce([cluster]).mockResolvedValueOnce([preview]);
    const url = "https://sidzen.shop/api/delivery/ozon/points/?view=viewport&bbox=37.3,55.5,37.9,55.9&zoom=11";
    expect((await GET(new Request(url))).status).toBe(503);
    const recovered = await GET(new Request(url));
    const payload = await recovered.json();
    expect(payload.points).toEqual([]); expect(payload.listPoints).toEqual([preview]);
    const cached = await GET(new Request(url, { headers: { "If-None-Match": recovered.headers.get("etag")! } }));
    expect(cached.status).toBe(304); expect(m.find).toHaveBeenCalledTimes(4);
    expect(m.info).not.toHaveBeenCalled();
  });
  it("caches the same viewport, changes area independently and invalidates after directory sync", async () => {
    m.find.mockResolvedValue([]);
    const url = "https://sidzen.shop/api/delivery/ozon/points/?view=viewport&bbox=37.3,55.5,37.9,55.9&zoom=11";
    const first = await GET(new Request(url));
    const data = await first.json();
    const conditional = await GET(new Request(url, { headers: { "If-None-Match": first.headers.get("etag")! } }));
    expect(conditional.status).toBe(304); expect(m.find).toHaveBeenCalledTimes(1);
    await GET(new Request(url.replace("37.3,55.5,37.9,55.9", "37.4,55.6,37.8,55.8")));
    expect(m.find).toHaveBeenCalledTimes(2);
    m.sync.mockResolvedValue({ generation: "next-directory", status: "SUCCEEDED" });
    const refreshed = await (await GET(new Request(url))).json();
    expect(refreshed.scope).not.toBe(data.scope); expect(m.find).toHaveBeenCalledTimes(3);
  });
  it.each(["view=viewport&bbox=37,55,37,56&zoom=10", "view=viewport&bbox=37,55,38,56&zoom=99", "view=city&q=%25__"])("rejects invalid progressive map input before any database work: %s", async query => {
    const response = await GET(new Request(`https://sidzen.shop/api/delivery/ozon/points/?${query}`));
    expect(response.status).toBe(400); expect(m.find).not.toHaveBeenCalled(); expect(m.config).not.toHaveBeenCalled();
  });
  it("does not use cached city or viewport results after integration is disabled", async () => {
    m.config.mockResolvedValue({ enabled: false });
    const response = await GET(new Request("https://sidzen.shop/api/delivery/ozon/points/?view=viewport&bbox=37.3,55.5,37.9,55.9&zoom=11"));
    expect(response.status).toBe(409); expect(m.find).not.toHaveBeenCalled();
  });
  it("pages even coincident addresses at maximum zoom without dropping points", async () => {
    const rows = Array.from({ length: 650 }, (_, index) => ({ id: String(index), count: 1, name: "ПВЗ", address: `Москва, улица ${index}`, type: "pvz", latitude: 55.7, longitude: 37.5, south: 55.7, west: 37.5, north: 55.7, east: 37.5 }));
    m.find.mockResolvedValueOnce(rows.slice(0, 501)).mockResolvedValueOnce(rows.slice(500));
    const url = "https://sidzen.shop/api/delivery/ozon/points/?view=viewport&bbox=37.49,55.69,37.51,55.71&zoom=18";
    const first = await (await GET(new Request(url))).json();
    const last = await (await GET(new Request(`${url}&offset=${first.nextOffset}`))).json();
    expect(first.points).toHaveLength(500); expect(first.nextOffset).toBe(500); expect(first.clusters).toEqual([]);
    expect(first.listPoints).toBeUndefined(); expect(last.listPoints).toBeUndefined();
    expect(m.find).toHaveBeenCalledTimes(2);
    expect(last.points).toHaveLength(150); expect(last.nextOffset).toBeNull(); expect(last.scope).toBe(first.scope);
    expect(new Set([...first.points, ...last.points].map(point => point.id)).size).toBe(650);
    expect(m.find.mock.calls[1][0].values.slice(-2)).toEqual([501, 500]);
  });
  it.each(["zoom=17&offset=500", "zoom=18&offset=-1", "zoom=18&offset=1.2", "zoom=18&offset=1000001"])("rejects invalid viewport pagination: %s", async suffix => {
    const response = await GET(new Request(`https://sidzen.shop/api/delivery/ozon/points/?view=viewport&bbox=37.49,55.69,37.51,55.71&${suffix}`));
    expect(response.status).toBe(400); expect(m.find).not.toHaveBeenCalled();
  });
  it("returns a retriable failure instead of an empty area when PostgreSQL is unavailable", async () => {
    m.find.mockRejectedValue(new Error("database"));
    const response = await GET(new Request("https://sidzen.shop/api/delivery/ozon/points/?q=Москва&view=city"));
    expect(response.status).toBe(503); expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
