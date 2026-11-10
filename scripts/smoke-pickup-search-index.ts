import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { pointSearchTerms } from "../src/lib/delivery/point-search";
import { pointSearchSql } from "../src/lib/delivery/point-search-sql";
import { pickupCitySql, pickupViewportListSql, pickupViewportSql } from "../src/lib/delivery/point-viewport-sql";
import { pickupCityOverview, pickupViewportResult, type PickupViewportRow } from "../src/lib/delivery/point-viewport";
import type { PickupPoint } from "../src/lib/delivery/points";

// Synthetic public addresses only. Refuse all production databases.
const db = new URL(process.env.DATABASE_URL || "");
assert(["localhost", "127.0.0.1"].includes(db.hostname) && db.pathname === "/shop_qa");
const marker = `qa-point-index-${randomUUID()}`;
type Point = { id: string; address: string };
type Explain = { Plan: { "Index Name"?: string; Plans?: Explain["Plan"][] }; "Execution Time": number };
const hasIndex = (plan: Explain["Plan"]): boolean => plan["Index Name"] === "OzonDeliveryPoint_address_search_idx" || (plan.Plans || []).some(hasIndex);
async function search(query: string) {
  return prisma.$queryRaw<Point[]>(pointSearchSql(marker, 7n, pointSearchTerms(query), 9));
}
try {
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "OzonDeliveryPoint" ("id", "name", "address", "type", "active", "clientId", "methodId", "generation", "updatedAt")
    SELECT ${marker} || '-' || n, 'Synthetic pickup point',
      CASE WHEN n <= 8 THEN 'Россия, Яблоновский, улица Гагарина, ' || (189 + n) || '/2'
        ELSE 'Россия, Испытательный город, улица Проверочная, ' || n END,
      'pvz', true, ${marker}, 7, ${marker}, NOW()
    FROM generate_series(1, 100000) AS n
  `);
  await prisma.ozonDeliveryPoint.createMany({ data: [
    { id: marker + '-orel', name: "QA", address: "Россия, Орёл, Берёзовая, 20/2", type: "pvz", active: true, clientId: marker, methodId: 7n, generation: marker },
    { id: marker + '-hyphen', name: "QA", address: "Россия, Ростов-на-Дону, улица Южная, 80Б", type: "pvz", active: true, clientId: marker, methodId: 7n, generation: marker },
    { id: marker + '-omsk', name: "QA", address: "Россия, Омск, Гагарина, 1", type: "pvz", active: true, clientId: marker, methodId: 7n, generation: marker },
    { id: marker + '-tomsk', name: "QA", address: "Россия, Томск, Гагарина, 1", type: "pvz", active: true, clientId: marker, methodId: 7n, generation: marker },
    { id: marker + '-inactive', name: "QA", address: "Россия, Яблоновский, Гагарина, 1", type: "pvz", active: false, clientId: marker, methodId: 7n, generation: marker },
    { id: marker + '-other-client', name: "QA", address: "Россия, Яблоновский, Гагарина, 1", type: "pvz", active: true, clientId: marker + '-other', methodId: 7n, generation: marker },
    { id: marker + '-other-method', name: "QA", address: "Россия, Яблоновский, Гагарина, 1", type: "pvz", active: true, clientId: marker, methodId: 8n, generation: marker },
  ] });
  await prisma.$executeRaw`ANALYZE "OzonDeliveryPoint"`;
  const expected = (await search("Яблоновский Гагарина")).map(point => point.id);
  assert.equal(expected.length, 8);
  for (const query of ["Яб", "гагар яблон", "ЯБЛОНОВСКИЙ, ГАГАРИНА", "Гагарина Яблоновский"]) {
    assert.deepEqual((await search(query)).map(point => point.id), expected, query);
    const result = await prisma.$queryRaw<[{ "QUERY PLAN": Explain[] }]>(Prisma.sql`EXPLAIN (ANALYZE, FORMAT JSON) ${pointSearchSql(marker, 7n, pointSearchTerms(query), 9)}`);
    const plan = result[0]["QUERY PLAN"][0];
    assert(hasIndex(plan.Plan), "Selective prefix searches must use the actual migration index, not scan 100,000 addresses");
    console.log(JSON.stringify({ query, indexed: true, executionMs: plan["Execution Time"], fixtureRows: 100007 }));
  }
  assert.deepEqual((await search("Яблоновский 19")), []);
  assert.equal((await search("яблон 190/2"))[0]?.id, marker + "-1");
  assert.equal((await search("берез орел 20/2"))[0]?.id, marker + "-orel");
  assert.deepEqual((await search("омск")).map(point => point.id), [marker + "-omsk"]);
  assert.equal((await search("Дон ростов 80"))[0]?.id, marker + "-hyphen");
  // GIN expression indexes follow updates/deactivation automatically: no stale cache.
  await prisma.ozonDeliveryPoint.update({ where: { id: marker + "-1" }, data: { active: false } });
  assert.equal((await search("яблон 190/2")).length, 0);
  await prisma.ozonDeliveryPoint.update({ where: { id: marker + "-2" }, data: { address: "Россия, Орёл, Берёзовая, 191/2" } });
  assert.equal((await search("яблон 191/2")).length, 0);
  assert.equal((await search("орел 191/2"))[0]?.id, marker + "-2");
  // A large city must not send 10,000 addresses before the map can open.
  // Only coordinates are read for the overview; viewports aggregate in SQL.
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "OzonDeliveryPoint" ("id", "name", "address", "type", "active", "clientId", "methodId", "generation", "latitude", "longitude", "updatedAt")
    SELECT ${marker} || '-moscow-' || n, 'Synthetic map point', 'Россия, Москва г., улица Проверочная, ' || n,
      'pvz', true, ${marker}, 7, ${marker}, 55.55 + (n % 100) * 0.004, 37.3 + (n / 100) * 0.006, NOW()
    FROM generate_series(0, 9999) AS n
  `);
  await prisma.ozonDeliveryPoint.createMany({ data: [
    { id: marker + '-city-tambov', name: "QA", address: "Россия, Тамбов, улица Ленина, 1", type: "pvz", active: true, clientId: marker, methodId: 7n, generation: marker, latitude: 52.72, longitude: 41.44 },
    { id: marker + '-prefix-tambov', name: "QA", address: "Россия, г.Тамбов, улица Ленина, 2", type: "pvz", active: true, clientId: marker, methodId: 7n, generation: marker, latitude: 52.73, longitude: 41.45 },
    { id: marker + '-suffix-petersburg', name: "QA", address: "Россия, Санкт-Петербург г., улица Ленина, 1", type: "pvz", active: true, clientId: marker, methodId: 7n, generation: marker, latitude: 59.9, longitude: 30.3 },
    { id: marker + '-street-tambov', name: "QA", address: "Россия, Омск, улица Тамбовская, 1", type: "pvz", active: true, clientId: marker, methodId: 7n, generation: marker, latitude: 55, longitude: 73.37 },
    { id: marker + '-region-tambov', name: "QA", address: "Россия, Тамбовская область, Мичуринск, улица Ленина, 1", type: "pvz", active: true, clientId: marker, methodId: 7n, generation: marker, latitude: 52.9, longitude: 40.49 },
    { id: marker + '-foreign-map', name: "QA", address: "Россия, Москва, улица Ленина, 1", type: "pvz", active: true, clientId: marker + '-other', methodId: 7n, generation: marker, latitude: 55.7, longitude: 37.5 },
    { id: marker + '-inactive-map', name: "QA", address: "Россия, Москва, улица Ленина, 1", type: "pvz", active: false, clientId: marker, methodId: 7n, generation: marker, latitude: 55.7, longitude: 37.5 },
    { id: marker + '-method-map', name: "QA", address: "Россия, Москва, улица Ленина, 1", type: "pvz", active: true, clientId: marker, methodId: 8n, generation: marker, latitude: 55.7, longitude: 37.5 },
  ] });
  const cityCoordinates = await prisma.$queryRaw<Array<{ latitude: number; longitude: number }>>(pickupCitySql(marker, 7n, "Москва"));
  assert.equal(cityCoordinates.length, 10000);
  const overview = pickupCityOverview("Москва", cityCoordinates);
  assert(overview && JSON.stringify(overview).length < 250);
  assert(overview.bounds.north - overview.bounds.south > 0.3);
  assert(overview.bounds.east - overview.bounds.west > 0.4);
  assert.deepEqual(await prisma.$queryRaw(pickupCitySql(marker, 7n, "Тамбов")), [{ latitude: 52.72, longitude: 41.44 }, { latitude: 52.73, longitude: 41.45 }]);
  assert.deepEqual(await prisma.$queryRaw(pickupCitySql(marker, 7n, "Санкт-Петербург")), [{ latitude: 59.9, longitude: 30.3 }]);
  assert.deepEqual(await prisma.$queryRaw(pickupCitySql(marker, 7n, "Табмов")), []);
  const broadBounds = { south: 55.5, west: 37.2, north: 56, east: 38 };
  const broad = await prisma.$queryRaw<PickupViewportRow[]>(pickupViewportSql(marker, 7n, { bounds: broadBounds, zoom: 10 }));
  assert(broad.length <= 25 && broad.length > 0, "A city overview must stay sparse");
  assert.equal(broad.reduce((sum, feature) => sum + feature.count, 0), 10000);
  const payload = pickupViewportResult(broad, "qa");
  assert(payload.clusters.length > 0 && JSON.stringify(payload).length < 10000);
  const nearby = await prisma.$queryRaw<PickupPoint[]>(pickupViewportListSql(marker, 7n, { bounds: broadBounds, zoom: 10 }));
  assert.equal(nearby.length, 20, "Only a small address preview should accompany overview clusters");
  assert.equal(new Set(nearby.map(point => point.id)).size, 20);
  assert(nearby.every(point => point.id.startsWith(marker + "-moscow-")), "Preview must exclude inactive points and other integrations");
  const center = { latitude: (broadBounds.south + broadBounds.north) / 2, longitude: (broadBounds.west + broadBounds.east) / 2 };
  const radians = (value: number) => value * Math.PI / 180;
  const distance = (point: { latitude: number; longitude: number }) => Math.sin(radians(point.latitude - center.latitude) / 2) ** 2
    + Math.cos(radians(center.latitude)) * Math.cos(radians(point.latitude)) * Math.sin(radians(point.longitude - center.longitude) / 2) ** 2;
  const expectedDistance = cityCoordinates.map(distance).sort((a, b) => a - b)[19];
  const previewDistances = nearby.map(point => distance({ latitude: point.latitude!, longitude: point.longitude! }));
  assert(previewDistances.every(value => value <= expectedDistance + 1e-15), "Preview must contain nearest addresses, not the first directory rows");
  assert(previewDistances.every((value, index) => index === 0 || value >= previewDistances[index - 1] - 1e-15));
  assert.equal(payload.points.length, 0, "Sidebar addresses must not increase the overview marker density");
  for (const [zoom, budget] of [[12, 36], [14, 49], [16, 64], [17, 64]]) {
    const features = await prisma.$queryRaw<PickupViewportRow[]>(pickupViewportSql(marker, 7n, { bounds: broadBounds, zoom }));
    assert(features.length > 0 && features.length <= budget, `Zoom ${zoom} must respect its marker budget`);
    assert.equal(features.reduce((sum, feature) => sum + feature.count, 0), 10000, "Progressive detail must not discard pickup points");
  }
  // Even a district below the old 500-point cutoff needs aggregation at a
  // broad zoom; the same addresses must remain reachable when zooming in.
  const moderateBounds = { south: 55.5499, west: 37.2999, north: 55.6461, east: 37.3661 };
  const moderate = await prisma.$queryRaw<PickupViewportRow[]>(pickupViewportSql(marker, 7n, { bounds: moderateBounds, zoom: 10 }));
  assert(moderate.length <= 25 && moderate.some(feature => feature.count > 1));
  assert.equal(moderate.reduce((sum, feature) => sum + feature.count, 0), 300);
  const expanded = await prisma.$queryRaw<PickupViewportRow[]>(pickupViewportSql(marker, 7n, { bounds: moderateBounds, zoom: 18 }));
  assert.equal(expanded.length, 300);
  assert(expanded.every(feature => feature.count === 1 && feature.address));
  const district = async (south: number, west: number, north: number, east: number) => {
    const features = await prisma.$queryRaw<PickupViewportRow[]>(pickupViewportSql(marker, 7n, { bounds: { south, west, north, east }, zoom: 15 }));
    const expected = await prisma.ozonDeliveryPoint.count({ where: { clientId: marker, methodId: 7n, active: true, latitude: { gte: south, lte: north }, longitude: { gte: west, lte: east } } });
    assert(expected > 0 && expected <= 500);
    assert(features.length <= 49);
    assert.equal(features.reduce((sum, feature) => sum + feature.count, 0), expected);
    assert(features.every(feature => feature.latitude >= south && feature.latitude <= north && feature.longitude >= west && feature.longitude <= east));
    const addresses = await prisma.$queryRaw<PickupViewportRow[]>(pickupViewportSql(marker, 7n, { bounds: { south, west, north, east }, zoom: 18 }));
    assert.equal(addresses.length, expected);
    assert(addresses.every(feature => feature.count === 1 && feature.address));
    return addresses;
  };
  const southwest = await district(55.55, 37.3, 55.59, 37.36);
  const northeast = await district(55.9, 37.8, 55.946, 37.894);
  assert(!southwest.some(point => northeast.some(other => point.id === other.id)));
  const westernPreview = await prisma.$queryRaw<PickupPoint[]>(pickupViewportListSql(marker, 7n, { bounds: { south: 55.55, west: 37.3, north: 55.59, east: 37.36 }, zoom: 15 }));
  const easternPreview = await prisma.$queryRaw<PickupPoint[]>(pickupViewportListSql(marker, 7n, { bounds: { south: 55.9, west: 37.8, north: 55.946, east: 37.894 }, zoom: 15 }));
  assert.equal(westernPreview.length, 20); assert.equal(easternPreview.length, 20);
  assert(westernPreview.every(point => southwest.some(other => other.id === point.id)));
  assert(easternPreview.every(point => northeast.some(other => other.id === point.id)));
  assert(!westernPreview.some(point => easternPreview.some(other => point.id === other.id)), "Panning must replace sidebar addresses with the new district");
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "OzonDeliveryPoint" ("id", "name", "address", "type", "active", "clientId", "methodId", "generation", "latitude", "longitude", "updatedAt")
    SELECT ${marker} || '-coincident-' || n, 'Synthetic coincident point', 'Россия, Москва, улица Совпадающая, ' || n,
      'pvz', true, ${marker}, 7, ${marker}, 55.7011, 37.5011, NOW()
    FROM generate_series(0, 649) AS n
  `);
  const tiny = { bounds: { south: 55.701, west: 37.501, north: 55.7012, east: 37.5012 }, zoom: 18 };
  const firstPage = await prisma.$queryRaw<PickupViewportRow[]>(pickupViewportSql(marker, 7n, tiny));
  const lastPage = await prisma.$queryRaw<PickupViewportRow[]>(pickupViewportSql(marker, 7n, tiny, 500));
  assert.equal(firstPage.length, 501); assert.equal(lastPage.length, 150);
  assert.equal(new Set([...firstPage.slice(0, 500), ...lastPage].map(point => point.id)).size, 650);
  assert([...firstPage, ...lastPage].every(point => point.count === 1 && point.address));
  console.log("PASS: compact Moscow overview, complete server cluster coverage of 10,000 points, twenty nearest scoped sidebar addresses, district zoom/pan, exact city matching, and integration scope.");
  console.log("PASS: indexed prefix lookup on 100,000 synthetic addresses, unchanged word/house matching, scope, ё/е, hyphens, updates and deactivation. No provider calls or customer data.");
} finally {
  await prisma.ozonDeliveryPoint.deleteMany({ where: { generation: marker, clientId: { in: [marker, marker + "-other"] } } });
  await prisma.$executeRaw`ANALYZE "OzonDeliveryPoint"`;
  await prisma.$disconnect();
}
