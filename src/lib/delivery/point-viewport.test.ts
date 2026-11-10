import { describe, expect, it } from "vitest";
import { normalizePickupCity, parsePickupViewport, parseViewportOffset, pickupCityOverview, pickupCityPattern, pickupViewportResult } from "./point-viewport";
import { pickupCitySql, pickupViewportSql } from "./point-viewport-sql";

describe("progressive pickup map boundaries", () => {
  it("parses a Moscow viewport without asking for a complete city", () => {
    expect(parsePickupViewport("37.3,55.5,37.9,55.9", "11")).toEqual({ bounds: { west: 37.3, south: 55.5, east: 37.9, north: 55.9 }, zoom: 11 });
    expect(parsePickupViewport("-180,-85,180,85", "3")).not.toBeNull();
  });
  it.each([
    [null, "10"], ["37,55,38", "10"], ["37,55,38,56,57", "10"], ["37,,38,56", "10"],
    ["NaN,55,38,56", "10"], ["Infinity,55,38,56", "10"], ["37,55,37,56", "10"],
    ["38,55,37,56", "10"], ["37,56,38,55", "10"], ["37,-90,38,56", "10"],
    ["37,55,181,56", "10"], ["37,55,38,56", "19"], ["37,55,38,56", "2"],
    ["37,55,38,56", "10.5"], ["37,55,38,56", null], ["37,55,38,56;DROP TABLE x", "10"],
  ])("refuses malformed bounds or zoom %s / %s", (bbox, zoom) => {
    expect(parsePickupViewport(bbox, zoom)).toBeNull();
  });
  it("matches whole settlement components, including Ozon city suffixes", () => {
    const pattern = pickupCityPattern("Тамбов")!;
    // PostgreSQL POSIX whitespace is translated solely for this regex unit check.
    const regex = new RegExp(pattern.replaceAll("[[:space:]]", "\\s"), "u");
    expect(regex.test("россия, тамбов, улица ленина, 1")).toBe(true);
    expect(regex.test("россия, тамбов г., улица ленина, 1")).toBe(true);
    expect(regex.test("россия, г. тамбов, улица ленина, 1")).toBe(true);
    expect(regex.test("россия, г.тамбов, улица ленина, 1")).toBe(true);
    const petersburg = new RegExp(pickupCityPattern("Санкт-Петербург")!.replaceAll("[[:space:]]", "\\s"), "u");
    expect(petersburg.test("россия, санкт-петербург г., улица ленина, 1")).toBe(true);
    expect(regex.test("россия, омск, улица тамбовская, 1")).toBe(false);
    expect(regex.test("россия, тамбовская область, мичуринск, улица ленина, 1")).toBe(false);
    expect(pickupCityPattern("Табмов")).not.toBe(pattern);
    expect(normalizePickupCity("  г. Орёл  ")).toBe("орел");
    expect(pickupCityPattern("%___")).toBeNull();
  });
  it("returns only a city overview even for 10,000 Moscow points", () => {
    const rows = Array.from({ length: 10000 }, (_, index) => ({ latitude: 55.55 + (index % 100) * 0.004, longitude: 37.3 + Math.floor(index / 100) * 0.006 }));
    const result = pickupCityOverview("Москва", rows)!;
    expect(result.name).toBe("Москва");
    expect(result.bounds.north - result.bounds.south).toBeGreaterThan(0.3);
    expect(result.bounds.east - result.bounds.west).toBeGreaterThan(0.4);
    expect(JSON.stringify(result).length).toBeLessThan(250);
  });
  it("does not use invalid coordinates and pads a small settlement", () => {
    expect(pickupCityOverview("Город", [{ latitude: null, longitude: null }, { latitude: 0, longitude: 0 }])).toBeNull();
    const city = pickupCityOverview("Посёлок", [{ latitude: 55, longitude: 37 }])!;
    expect(city.bounds.south).toBeLessThan(55); expect(city.bounds.north).toBeGreaterThan(55);
  });
  it("uses bound SQL inputs and a city component filter", () => {
    const sql = pickupCitySql("client", 7n, "Москва");
    expect(sql.text).toContain("@@ to_tsquery('simple'::regconfig");
    expect(sql.text).not.toContain("москва");
    expect(sql.values).toContain(pickupCityPattern("Москва"));
    expect(sql.text).toContain('SELECT "latitude", "longitude"');
    expect(sql.text).not.toContain("LIMIT");
  });
  it("uses geographic bounds and compact SQL aggregation without arbitrary first-page limits", () => {
    const sql = pickupViewportSql("client", 7n, parsePickupViewport("37.3,55.5,37.9,55.9", "11")!);
    expect(sql.values).toContain(37.3); expect(sql.values).toContain(55.9);
    expect(sql.text).toContain('"active" = true');
    expect(sql.text).toContain("GROUP BY cell");
    expect(sql.text).toContain("count(*)::integer");
    expect(sql.text).not.toContain("OFFSET"); expect(sql.text).not.toContain("LIMIT");
  });
  it("permits explicit paging only at maximum zoom and binds its cursor", () => {
    expect(parseViewportOffset(null, 10)).toBe(0);
    expect(parseViewportOffset("500", 18)).toBe(500);
    expect(parseViewportOffset("500", 17)).toBeNull();
    for (const invalid of ["-1", "1.5", "1000001", "500;select 1"]) expect(parseViewportOffset(invalid, 18)).toBeNull();
    const sql = pickupViewportSql("client", 7n, parsePickupViewport("37.5,55.7,37.51,55.71", "18")!, 500);
    expect(sql.text).toContain('ORDER BY "id" ASC LIMIT');
    expect(sql.values.slice(-2)).toEqual([501, 500]);
    expect(sql.text).not.toContain("GROUP BY");
  });
  it("preserves cluster coverage and exposes only public individual point fields", () => {
    const base = { latitude: 55.7, longitude: 37.5, south: 55.6, west: 37.4, north: 55.8, east: 37.6 };
    expect(pickupViewportResult([
      { ...base, id: "a", count: 1800, name: null, address: null, type: null },
      { ...base, id: "b", count: 1, name: "ПВЗ", address: "Россия, Москва, улица Ленина, 1", type: "pvz" },
    ], "scope")).toEqual({ scope: "scope", points: [{ id: "b", name: "ПВЗ", address: "Россия, Москва, улица Ленина, 1", type: "pvz", latitude: 55.7, longitude: 37.5 }], clusters: [{ id: "cluster:a", count: 1800, latitude: 55.7, longitude: 37.5, bounds: { south: 55.6, west: 37.4, north: 55.8, east: 37.6 } }] });
  });
});
